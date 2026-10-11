import { memo, useLayoutEffect, useRef } from "react";
import type { ChatMode, DecisionAnswer } from "@shared/protocol";
import { ConfirmCard } from "@/components/chat/confirm-card";
import { DecisionCard } from "@/components/chat/decision-card";
import { DeliveryCard } from "@/components/chat/delivery-card";
import { Markdown } from "@/components/chat/markdown";
import { ThinkingIndicator } from "@/components/chat/thinking-indicator";
import { ToolTimer } from "@/components/chat/tool-timer";
import { parseCommand } from "@/lib/chat/commands";
import { bashTimeoutMs, isHidden, toolDetail } from "@/lib/chat/present";
import type { ChatMessage } from "@/lib/chat/types";
import { formatClock, formatIso, nowMs } from "@/lib/time";
import { cn } from "@/lib/utils";

const STICK_THRESHOLD_PX = 96;

function ErrorBlock({ text }: { text: string }) {
  return (
    <div data-tone="critical" className="mypi-message-system px-4 py-3 text-[15px] leading-7 break-words">
      {text}
    </div>
  );
}

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
  onDecisionAnswer: (toolCallId: string, answers: DecisionAnswer[]) => Promise<void>;
  onConfirmAnswer: (yes: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const emptyHint = messages.length === 0 && !(mode === "deliver" && running);
  const streamingAssistant = messages.some(
    (message) => message.role === "assistant" && message.streaming,
  );
  const showWorking = running && !waitingForUser && (mode === "deliver" || !streamingAssistant);

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
        {showWorking ? (
          <div className="px-4 py-3 text-[15px] leading-7">
            <ThinkingIndicator
              label={mode === "deliver" ? "Working" : "Thinking"}
              startedAt={runStartedAt ?? nowMs()}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  mode,
  onDecisionAnswer,
  onConfirmAnswer,
}: {
  message: ChatMessage;
  mode: ChatMode;
  onDecisionAnswer: (toolCallId: string, answers: DecisionAnswer[]) => Promise<void>;
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
        dateTime={formatIso(message.createdAt)}
        className="absolute top-3 right-4 text-sm opacity-0 group-hover:opacity-100"
      >
        {formatClock(message.createdAt)}
      </time>
    </div>
  );
});

function MessageBody({
  message,
  mode,
  onDecisionAnswer,
  onConfirmAnswer,
}: {
  message: ChatMessage;
  mode: ChatMode;
  onDecisionAnswer: (toolCallId: string, answers: DecisionAnswer[]) => Promise<void>;
  onConfirmAnswer: (yes: boolean) => void;
}) {
  if (message.role === "confirm") {
    return <ConfirmCard message={message} onAnswer={onConfirmAnswer} />;
  }

  if (message.role === "notice") {
    return (
      <div data-tone="info" className="mypi-message-system px-4 py-3 text-[15px] leading-7">
        <p className="font-semibold">{message.title}</p>
        {message.text ? <p className="mt-1 whitespace-pre-wrap">{message.text}</p> : null}
        {message.error ? <p className="mt-2 text-destructive">{message.error}</p> : null}
      </div>
    );
  }

  if (message.role === "user") {
    const isCommand = parseCommand(message.text) !== null;
    return (
      <div className="mypi-message-user px-4 py-3 text-[15px] leading-7">
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
    const detail = toolDetail(message);
    const showTimer = message.status === "running" || message.finishedAt !== null;
    return (
      <div className="text-[15px] leading-7">
        <p
          data-status={message.status}
          className="mypi-message-tool flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-3"
        >
          <span className="font-semibold">{message.name}</span>
          {detail ? <span className="min-w-0 break-all">{detail}</span> : null}
          {showTimer ? (
            <span className="ml-auto shrink-0 tabular-nums">
              <ToolTimer
                startedAt={message.startedAt}
                finishedAt={message.finishedAt}
                timeoutMs={message.name === "Bash" ? bashTimeoutMs(message.args) : undefined}
              />
            </span>
          ) : null}
        </p>
        {message.error ? <ErrorBlock text={message.error} /> : null}
      </div>
    );
  }

  if (mode === "deliver") {
    return message.error ? <ErrorBlock text={message.error} /> : null;
  }

  return (
    <div className="mypi-message-assistant text-[15px] leading-7">
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
