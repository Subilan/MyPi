import { useLayoutEffect, useRef } from "react";
import type { ChatMode, DecisionAnswer } from "@shared/protocol";
import { ConfirmCard } from "@/components/chat/confirm-card";
import { DecisionCard } from "@/components/chat/decision-card";
import { DeliveryCard } from "@/components/chat/delivery-card";
import { Markdown } from "@/components/chat/markdown";
import { ThinkingIndicator } from "@/components/chat/thinking-indicator";
import { parseCommand } from "@/lib/chat/commands";
import type { ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const STICK_THRESHOLD_PX = 96;

const MAX_ARGS_CHARS = 400;

const DELIVER_TOOLS = new Set(["report_success", "report_failure", "request_user_decision"]);

const ERROR_BLOCK = "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100";

const TOOL_STYLES: Record<"running" | "ok" | "error", string> = {
  running: "bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
  ok: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  error: ERROR_BLOCK,
};

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  let text: string;
  try {
    text = JSON.stringify(args) ?? "";
  } catch {
    text = String(args);
  }
  return text.length > MAX_ARGS_CHARS ? `${text.slice(0, MAX_ARGS_CHARS)}…` : text;
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div className={cn("px-4 py-3 text-[15px] leading-7 break-words", ERROR_BLOCK)}>{text}</div>
  );
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function Transcript({
  messages,
  mode,
  running,
  waitingForUser,
  runStartedAt,
  onDecisionAnswer,
  onConfirmAnswer,
}: {
  messages: ChatMessage[];
  mode: ChatMode;
  running: boolean;
  waitingForUser: boolean;
  runStartedAt: number | null;
  onDecisionAnswer: (toolCallId: string, answers: DecisionAnswer[]) => void;
  onConfirmAnswer: (yes: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const emptyHint = messages.length === 0 && !(mode === "deliver" && running);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, running, waitingForUser]);

  const onScroll = () => {
    const node = containerRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickRef.current = distance < STICK_THRESHOLD_PX;
  };

  return (
    <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("flex w-full flex-col pb-6", emptyHint && "min-h-full justify-center")}>
        {emptyHint ? (
          <p className="px-4 text-center text-sm text-muted-foreground">输入消息或指令以开始</p>
        ) : (
          messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              mode={mode}
              onDecisionAnswer={onDecisionAnswer}
              onConfirmAnswer={onConfirmAnswer}
            />
          ))
        )}
        {mode === "deliver" && running && !waitingForUser ? (
          <div className="px-4 py-3 text-[15px] leading-7">
            <ThinkingIndicator label="Working" startedAt={runStartedAt ?? Date.now()} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isHidden(message: ChatMessage, mode: ChatMode): boolean {
  if (mode !== "deliver") return false;
  if (message.role === "assistant") return !message.error;
  if (message.role === "tool") return !DELIVER_TOOLS.has(message.name);
  return false;
}

function MessageRow({
  message,
  mode,
  onDecisionAnswer,
  onConfirmAnswer,
}: {
  message: ChatMessage;
  mode: ChatMode;
  onDecisionAnswer: (toolCallId: string, answers: DecisionAnswer[]) => void;
  onConfirmAnswer: (yes: boolean) => void;
}) {
  if (isHidden(message, mode)) return null;
  return (
    <div className="group relative">
      <MessageBody
        message={message}
        mode={mode}
        onDecisionAnswer={onDecisionAnswer}
        onConfirmAnswer={onConfirmAnswer}
      />
      <time
        dateTime={new Date(message.createdAt).toISOString()}
        className="absolute top-3 right-4 text-sm opacity-0 group-hover:opacity-100"
      >
        {clockFormatter.format(message.createdAt)}
      </time>
    </div>
  );
}

function MessageBody({
  message,
  mode,
  onDecisionAnswer,
  onConfirmAnswer,
}: {
  message: ChatMessage;
  mode: ChatMode;
  onDecisionAnswer: (toolCallId: string, answers: DecisionAnswer[]) => void;
  onConfirmAnswer: (yes: boolean) => void;
}) {
  if (message.role === "confirm") {
    return <ConfirmCard message={message} onAnswer={onConfirmAnswer} />;
  }

  if (message.role === "notice") {
    return (
      <div className="bg-sky-50 px-4 py-3 text-[15px] leading-7 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
        <p className="font-semibold">{message.title}</p>
        {message.text ? <p className="mt-1 whitespace-pre-wrap">{message.text}</p> : null}
        {message.error ? <p className="mt-2 text-destructive">{message.error}</p> : null}
      </div>
    );
  }

  if (message.role === "user") {
    const isCommand = parseCommand(message.text) !== null;
    return (
      <div className="bg-muted px-4 py-3 text-[15px] leading-7">
        <p className={cn("whitespace-pre-wrap", isCommand ? "font-bold text-primary" : null)}>
          {message.text}
        </p>
      </div>
    );
  }

  if (message.role === "error") {
    return <ErrorBlock text={message.text} />;
  }

  if (message.role === "tool") {
    if (message.name === "report_success") {
      return <DeliveryCard status="success" args={message.args} />;
    }
    if (message.name === "report_failure") {
      return <DeliveryCard status="failure" args={message.args} />;
    }
    if (message.name === "request_user_decision") {
      return <DecisionCard message={message} onAnswer={onDecisionAnswer} />;
    }
    const args = formatArgs(message.args);
    return (
      <div className={cn("px-4 py-3 text-[15px] leading-7", TOOL_STYLES[message.status])}>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold">{message.name}</span>
          {args ? <span className="min-w-0 break-all opacity-80">{args}</span> : null}
        </p>
      </div>
    );
  }

  if (mode === "deliver") {
    return message.error ? <ErrorBlock text={message.error} /> : null;
  }

  return (
    <div className="text-[15px] leading-7">
      {message.thinking || message.text ? (
        <div className="px-4 py-3">
          {message.thinking ? <ThinkingIndicator startedAt={message.startedAt} /> : null}
          {message.text ? <Markdown text={message.text} caret={message.streaming} /> : null}
        </div>
      ) : null}
      {message.error ? <ErrorBlock text={message.error} /> : null}
    </div>
  );
}
