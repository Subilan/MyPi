import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { DecisionAnswer, DecisionQuestion } from "../../shared/protocol.ts";

export class DecisionRegistry {
  private pending = new Map<string, (answers: DecisionAnswer[]) => void>();
  private early = new Map<string, DecisionAnswer[]>();

  wait(toolCallId: string, signal?: AbortSignal): Promise<DecisionAnswer[]> {
    const early = this.early.get(toolCallId);
    if (early) {
      this.early.delete(toolCallId);
      return Promise.resolve(early);
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(toolCallId);
        this.early.delete(toolCallId);
        reject(new Error("已中止"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.pending.set(toolCallId, (answers) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(answers);
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  answer(toolCallId: string, answers: DecisionAnswer[]): boolean {
    const resolve = this.pending.get(toolCallId);
    if (resolve) {
      this.pending.delete(toolCallId);
      resolve(answers);
      return true;
    }
    this.early.set(toolCallId, answers);
    return false;
  }
}

const successParameters = Type.Object({
  description: Type.String({
    maxLength: 50,
    description: "对已完成任务的简要描述，不超过 50 字",
  }),
  nextSteps: Type.Optional(
    Type.Array(Type.String(), { description: "建议用户接下来可以做的事" }),
  ),
  artifacts: Type.Optional(
    Type.Array(Type.String(), { description: "交付产物的路径，可以是网页链接或本地绝对路径" }),
  ),
});

const failureParameters = Type.Object({
  reason: Type.String({ maxLength: 50, description: "无法按要求交付的原因，不超过 50 字" }),
  suggestion: Type.Optional(
    Type.Array(Type.String(), { description: "用户可以如何调整需求或环境的建议" }),
  ),
});

const decisionParameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({ description: "问题标识，答案会按这个 id 返回" }),
      type: Type.Union([Type.Literal("yes_no"), Type.Literal("single"), Type.Literal("multi")], {
        description: "yes_no 是是否题，single 是单选题，multi 是多选题",
      }),
      question: Type.String({ description: "要问用户的问题" }),
      options: Type.Optional(
        Type.Array(
          Type.Object({
            label: Type.String({
              description: "选项内容，不要自行创建其它选项",
            }),
            description: Type.Optional(
              Type.String({ description: "选项介绍，鼠标悬停时展示" }),
            ),
          }),
        ),
      ),
      show_other_choice: Type.Optional(
        Type.Boolean({
          description: "展示一个允许用户自由输入的其它选项，默认展示，不要自行创建其它选项",
        }),
      ),
    }),
  ),
});

export function createDeliverTools(decisions: DecisionRegistry): AgentTool<any>[] {
  return [reportSuccess(), reportFailure(), requestUserDecision(decisions)];
}

function reportSuccess(): AgentTool<typeof successParameters> {
  return {
    name: "report_success",
    label: "交付成功",
    description:
      "任务已经按要求完成时调用，向用户结构化交付结果。调用后本次任务结束。",
    parameters: successParameters,
    async execute(_id, params): Promise<AgentToolResult> {
      return {
        content: [{ type: "text", text: "已向用户交付成功结果，本次任务结束。" }],
        details: {
          description: params.description,
          nextSteps: params.nextSteps ?? [],
          artifacts: params.artifacts ?? [],
        },
      };
    },
  };
}

function reportFailure(): AgentTool<typeof failureParameters> {
  return {
    name: "report_failure",
    label: "交付失败",
    description:
      "无法按要求完成任务时调用，向用户说明原因。调用后本次任务结束。",
    parameters: failureParameters,
    async execute(_id, params): Promise<AgentToolResult> {
      return {
        content: [{ type: "text", text: "已向用户交付失败原因，本次任务结束。" }],
        details: { reason: params.reason, suggestion: params.suggestion ?? [] },
      };
    },
  };
}

function requestUserDecision(
  decisions: DecisionRegistry,
): AgentTool<typeof decisionParameters> {
  return {
    name: "request_user_decision",
    label: "请求用户选择",
    description:
      "需要用户做选择时调用，可一次传入多个问题。调用会阻塞，直到用户在界面上作答，答案会作为工具结果返回。",
    parameters: decisionParameters,
    async execute(toolCallId, params, signal): Promise<AgentToolResult> {
      const questions = params.questions;
      const invalid = questions.find(
        (question) =>
          (question.type === "single" || question.type === "multi") &&
          (question.options === undefined || question.options.length === 0),
      );
      if (invalid) {
        return {
          content: [
            {
              type: "text",
              text: `问题 ${invalid.id} 的类型是 ${invalid.type}，必须提供非空的 options，请重新调用`,
            },
          ],
          details: {},
          isError: true,
        };
      }
      const answers = await decisions.wait(toolCallId, signal);
      return {
        content: [{ type: "text", text: summarize(questions, answers) }],
        details: {
          questions,
          answers: answers.map((answer) => ({ id: answer.id, value: answer.value })),
        },
      };
    },
  };
}

function summarize(questions: DecisionQuestion[], answers: DecisionAnswer[]): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer.value]));
  const lines = questions.map((question) => {
    const value = byId.get(question.id);
    const rendered = Array.isArray(value) ? value.join("、") : (value ?? "(未作答)");
    return `[${question.id}] ${question.question} -> ${rendered}`;
  });
  return ["用户的回答：", ...lines].join("\n");
}
