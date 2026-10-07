import { useState } from "react";
import type { DecisionAnswer, DecisionOption, DecisionQuestion } from "@shared/protocol";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ToolMessage } from "@/lib/chat/types";

const OTHER = "__other__";

const TYPE_LABEL: Record<DecisionQuestion["type"], string> = {
  yes_no: "YES/NO",
  single: "SINGLE",
  multi: "MULTI",
};

function parseOptions(value: unknown): DecisionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (typeof raw.label !== "string" || raw.label.trim().length === 0) return [];
    const description =
      typeof raw.description === "string" && raw.description.trim().length > 0
        ? raw.description
        : undefined;
    return [{ label: raw.label, description }];
  });
}

function parseQuestions(args: unknown): DecisionQuestion[] {
  const data = (args && typeof args === "object" ? args : {}) as { questions?: unknown };
  if (!Array.isArray(data.questions)) return [];
  return data.questions.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.question !== "string") return [];
    const type =
      raw.type === "yes_no" || raw.type === "single" || raw.type === "multi" ? raw.type : "yes_no";
    return [
      {
        id: raw.id,
        type,
        question: raw.question,
        options: parseOptions(raw.options),
        show_other_choice: raw.show_other_choice !== false,
      },
    ];
  });
}

function isAnswered(
  question: DecisionQuestion,
  value: string | string[] | undefined,
  other: string,
): boolean {
  if (question.type === "multi") {
    if (!Array.isArray(value) || value.length === 0) return false;
    return !value.includes(OTHER) || other.trim().length > 0;
  }
  if (typeof value !== "string" || value.length === 0) return false;
  return value !== OTHER || other.trim().length > 0;
}

function resolveValue(
  question: DecisionQuestion,
  value: string | string[] | undefined,
  other: string,
): string | string[] {
  if (question.type === "multi") {
    const list = Array.isArray(value) ? value : [];
    return list
      .map((item) => (item === OTHER ? other.trim() : item))
      .filter((item) => item.length > 0);
  }
  if (value === OTHER) return other.trim();
  return typeof value === "string" ? value : "";
}

function OptionLabel({ option }: { option: DecisionOption }) {
  if (!option.description) return <span>{option.label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-dotted underline-offset-4"
        >
          {option.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{option.description}</TooltipContent>
    </Tooltip>
  );
}

function QuestionBody({
  question,
  index,
  value,
  other,
  pending,
  onChoose,
  onOther,
}: {
  question: DecisionQuestion;
  index: number;
  value: string | string[] | undefined;
  other: string;
  pending: boolean;
  onChoose: (value: string) => void;
  onOther: (text: string) => void;
}) {
  const isMulti = question.type === "multi";
  const options = question.type === "yes_no" ? [] : (question.options ?? []);
  const selected = (label: string) =>
    isMulti ? Array.isArray(value) && value.includes(label) : value === label;
  const otherId = `${question.id}-other`;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] leading-7">
        <span className="opacity-70">{index + 1}.</span>{" "}
        {question.question}
        <span className="ml-2 text-xs font-semibold opacity-70">
          {TYPE_LABEL[question.type]}
        </span>
      </p>
      {question.type === "yes_no" ? (
        <ToggleGroup
          type="single"
          value={typeof value === "string" ? value : ""}
          disabled={!pending}
          onValueChange={(next) => {
            if (next) onChoose(next);
          }}
        >
          {["是", "否"].map((label) => (
            <ToggleGroupItem key={label} value={label} disabled={!pending}>
              {label}
            </ToggleGroupItem>
          ))}
          {question.show_other_choice ? (
            <ToggleGroupItem value={OTHER} disabled={!pending}>
              其它
            </ToggleGroupItem>
          ) : null}
        </ToggleGroup>
      ) : isMulti ? (
        <div className="flex flex-col gap-2" role="group">
          {options.map((option) => {
            const id = `${question.id}-${option.label}`;
            return (
              <div key={option.label} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={selected(option.label)}
                  disabled={!pending}
                  onCheckedChange={() => onChoose(option.label)}
                />
                <Label htmlFor={id} className="font-normal">
                  <OptionLabel option={option} />
                </Label>
              </div>
            );
          })}
          {question.show_other_choice ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={otherId}
                checked={selected(OTHER)}
                disabled={!pending}
                onCheckedChange={() => onChoose(OTHER)}
              />
              <Label htmlFor={otherId} className="font-normal">
                其它
              </Label>
            </div>
          ) : null}
        </div>
      ) : (
        <RadioGroup
          value={typeof value === "string" ? value : ""}
          disabled={!pending}
          onValueChange={onChoose}
        >
          {options.map((option) => {
            const id = `${question.id}-${option.label}`;
            return (
              <div key={option.label} className="flex items-center gap-2">
                <RadioGroupItem value={option.label} id={id} />
                <Label htmlFor={id} className="font-normal">
                  <OptionLabel option={option} />
                </Label>
              </div>
            );
          })}
          {question.show_other_choice ? (
            <div className="flex items-center gap-2">
              <RadioGroupItem value={OTHER} id={otherId} />
              <Label htmlFor={otherId} className="font-normal">
                其它
              </Label>
            </div>
          ) : null}
        </RadioGroup>
      )}
      {question.show_other_choice && selected(OTHER) ? (
        <Input
          value={other}
          disabled={!pending}
          placeholder="请输入其它内容"
          onChange={(event) => onOther(event.target.value)}
        />
      ) : null}
    </div>
  );
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
  const [others, setOthers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const pending = message.status === "running" && !submitted;
  const complete = questions.every((question) =>
    isAnswered(question, answers[question.id], others[question.id] ?? ""),
  );

  const choose = (question: DecisionQuestion, value: string) => {
    setAnswers((current) => {
      if (question.type !== "multi") return { ...current, [question.id]: value };
      const selected = Array.isArray(current[question.id])
        ? (current[question.id] as string[])
        : [];
      const next = selected.includes(value)
        ? selected.filter((item) => item !== value)
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
        value: resolveValue(question, answers[question.id], others[question.id] ?? ""),
      })),
    );
  };

  return (
    <TooltipProvider>
      <div data-tone="info" className="ar-message-system px-4 py-3 text-[15px] leading-7">
        <p className="font-semibold">CLARIFY</p>
        <div className="mt-3 flex flex-col gap-4">
          {questions.map((question, index) => (
            <QuestionBody
              key={question.id}
              question={question}
              index={index}
              value={answers[question.id]}
              other={others[question.id] ?? ""}
              pending={pending}
              onChoose={(value) => choose(question, value)}
              onOther={(text) => setOthers((current) => ({ ...current, [question.id]: text }))}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" disabled={!pending || !complete} onClick={submit}>
            {submitted ? "已提交" : "提交"}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
