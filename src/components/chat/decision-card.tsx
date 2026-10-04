import { useState } from "react";
import { HelpCircleIcon } from "lucide-react";
import type { DecisionAnswer, DecisionQuestion } from "@shared/protocol";
import { Button } from "@/components/ui/button";
import type { ToolMessage } from "@/lib/chat/types";

const TYPE_LABEL: Record<DecisionQuestion["type"], string> = {
  yes_no: "是否题",
  single: "单选题",
  multi: "多选题",
};

function parseQuestions(args: unknown): DecisionQuestion[] {
  const data = (args && typeof args === "object" ? args : {}) as { questions?: unknown };
  if (!Array.isArray(data.questions)) return [];
  return data.questions.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.question !== "string") return [];
    const type =
      raw.type === "yes_no" || raw.type === "single" || raw.type === "multi" ? raw.type : "yes_no";
    const options = Array.isArray(raw.options)
      ? raw.options.filter((option): option is string => typeof option === "string")
      : undefined;
    return [{ id: raw.id, type, question: raw.question, options }];
  });
}

function answered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.length > 0;
}

export function DecisionCard({
  message,
  onAnswer,
}: {
  message: ToolMessage;
  onAnswer: (toolCallId: string, answers: DecisionAnswer[]) => void;
}) {
  const questions = parseQuestions(message.args);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  const pending = message.status === "running" && !submitted;
  const complete = questions.every((question) => answered(answers[question.id]));

  const choose = (question: DecisionQuestion, value: string) => {
    setAnswers((current) => {
      if (question.type !== "multi") return { ...current, [question.id]: value };
      const selected = Array.isArray(current[question.id]) ? (current[question.id] as string[]) : [];
      const next = selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value];
      return { ...current, [question.id]: next };
    });
  };

  const submit = () => {
    if (!complete) return;
    setSubmitted(true);
    onAnswer(
      message.toolCallId,
      questions.map((question) => ({
        id: question.id,
        value: answers[question.id] ?? (question.type === "multi" ? [] : ""),
      })),
    );
  };

  return (
    <div className="bg-sky-50 px-4 py-3 text-[15px] leading-7 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
      <p className="flex items-center gap-2 font-semibold">
        <HelpCircleIcon className="text-sky-600 dark:text-sky-400" />
        需要你的选择
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {questions.map((question, index) => {
          const value = answers[question.id];
          const options =
            question.type === "yes_no" ? ["是", "否"] : (question.options ?? []);
          return (
            <div key={question.id}>
              <p className="text-[15px] leading-7">
                <span className="text-sky-700/80 dark:text-sky-300/80">{index + 1}.</span>{" "}
                {question.question}
                <span className="ml-2 text-xs text-sky-700/80 dark:text-sky-300/80">
                  {TYPE_LABEL[question.type]}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {options.map((option) => {
                  const selected =
                    question.type === "multi"
                      ? Array.isArray(value) && value.includes(option)
                      : value === option;
                  return (
                    <Button
                      key={option}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      disabled={!pending}
                      onClick={() => choose(question, option)}
                    >
                      {option}
                    </Button>
                  );
                })}
                {options.length === 0 ? (
                  <span className="text-xs text-sky-700/80 dark:text-sky-300/80">
                    模型没有提供候选项
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={!pending || !complete} onClick={submit}>
          {submitted ? "已提交" : "提交"}
        </Button>
        {message.status === "error" ? (
          <span className="text-xs text-destructive">{message.error ?? "提交失败"}</span>
        ) : submitted ? (
          <span className="text-xs text-sky-700/80 dark:text-sky-300/80">已把回答发给模型</span>
        ) : null}
      </div>
    </div>
  );
}
