import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  AgentAssistantTextData,
  AgentMessageEndData,
  AgentMessageStartData,
  AgentRunErrorData,
  AgentToolEndData,
  AgentToolStartData,
  AgentToolUpdateData,
} from "@shared/protocol";
import type { RunClock } from "@/hooks/use-run-clock";
import { errorFor } from "@/lib/chat/agent-helpers";
import type {
  AssistantMessage,
  ChatMessage,
  ConfirmMessage,
  ErrorMessage,
  NoticeMessage,
  ToolMessage,
  UserMessage,
} from "@/lib/chat/types";
import { nowMs } from "@/lib/time";

const DECISION_TOOL = "request_user_decision";

export interface AgentTranscript {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  appendNotice(notice: Omit<NoticeMessage, "id" | "role" | "createdAt">): void;
  appendError(text: string): void;
  appendConfirm(confirm: Omit<ConfirmMessage, "id" | "role" | "createdAt" | "answer">): void;
  appendUserMessage(text: string): void;
  clearMessages(): void;
  createId(): string;
  failAssistant(reason: string): void;
  finalizeAssistant(patch: (message: AssistantMessage) => AssistantMessage): void;
  resetAssistant(): void;
  resetAbort(): void;
  requestAbort(): void;
  releaseAbort(): void;
  handleEvent(name: string, data: unknown): void;
}

export function useAgentTranscript(clock: RunClock): AgentTranscript {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const counterRef = useRef(0);
  const assistantIdRef = useRef<string | null>(null);
  const abortingRef = useRef(false);
  const abortReportedRef = useRef(false);
  const { beginWaiting, endWaiting, stop } = clock;

  const nextId = useCallback(() => `msg-${(counterRef.current += 1)}`, []);

  const appendNotice = useCallback(
    (notice: Omit<NoticeMessage, "id" | "role" | "createdAt">) => {
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "notice", createdAt: nowMs(), ...notice },
      ]);
    },
    [nextId],
  );

  const appendError = useCallback(
    (text: string) => {
      const message: ErrorMessage = {
        id: nextId(),
        role: "error",
        text,
        createdAt: nowMs(),
      };
      setMessages((current) => [...current, message]);
    },
    [nextId],
  );

  const appendConfirm = useCallback(
    (confirm: Omit<ConfirmMessage, "id" | "role" | "createdAt" | "answer">) => {
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "confirm", createdAt: nowMs(), answer: null, ...confirm },
      ]);
    },
    [nextId],
  );

  const appendUserMessage = useCallback(
    (text: string) => {
      const now = nowMs();
      const message: UserMessage = {
        id: nextId(),
        role: "user",
        text,
        createdAt: now,
        startedAt: now,
      };
      setMessages((current) => [...current, message]);
    },
    [nextId],
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  const resetAssistant = useCallback(() => {
    assistantIdRef.current = null;
  }, []);

  const reportAbort = useCallback(() => {
    if (abortReportedRef.current) return;
    abortReportedRef.current = true;
    appendError("已中止");
  }, [appendError]);

  const startAssistant = useCallback(() => {
    const id = nextId();
    assistantIdRef.current = id;
    const now = nowMs();
    const message: AssistantMessage = {
      id,
      role: "assistant",
      text: "",
      createdAt: now,
      startedAt: now,
      streaming: true,
      thinking: true,
      error: null,
    };
    setMessages((current) => [...current, message]);
  }, [nextId]);

  const patchAssistant = useCallback(
    (patch: (message: AssistantMessage) => AssistantMessage) => {
      const id = assistantIdRef.current;
      if (id === null) return;
      setMessages((current) =>
        current.map((message) =>
          message.id === id && message.role === "assistant" ? patch(message) : message,
        ),
      );
    },
    [],
  );

  const finalizeAssistant = useCallback(
    (patch: (message: AssistantMessage) => AssistantMessage) => {
      const id = assistantIdRef.current;
      assistantIdRef.current = null;
      if (id === null) return;
      setMessages((current) => {
        const index = current.findIndex((message) => message.id === id);
        if (index < 0) return current;
        const found = current[index];
        if (found.role !== "assistant") return current;
        const patched = patch(found);
        if (!patched.text && !patched.error && !patched.streaming) {
          return current.filter((message) => message.id !== id);
        }
        const next = current.slice();
        next[index] = patched;
        return next;
      });
    },
    [],
  );

  const failAssistant = useCallback(
    (reason: string) => {
      if (assistantIdRef.current !== null) {
        finalizeAssistant((message) => ({
          ...message,
          streaming: false,
          thinking: false,
          error: reason,
        }));
      } else {
        appendError(reason);
      }
    },
    [appendError, finalizeAssistant],
  );

  const resetAbort = useCallback(() => {
    abortingRef.current = false;
    abortReportedRef.current = false;
  }, []);

  const requestAbort = useCallback(() => {
    abortingRef.current = true;
  }, []);

  const releaseAbort = useCallback(() => {
    abortingRef.current = false;
  }, []);

  const handleEvent = useCallback(
    (name: string, data: unknown) => {
      switch (name) {
        case "message_start": {
          const start = data as AgentMessageStartData;
          if (start.role !== "assistant") return;
          startAssistant();
          return;
        }
        case "assistant_text": {
          const { text } = data as AgentAssistantTextData;
          patchAssistant((message) => ({ ...message, text, thinking: false }));
          return;
        }
        case "message_end": {
          const end = data as AgentMessageEndData;
          if (end.role !== "assistant") return;
          finalizeAssistant((message) => ({
            ...message,
            text: typeof end.text === "string" ? end.text : message.text,
            streaming: false,
            thinking: false,
            error: errorFor(end),
          }));
          if (end.stopReason === "aborted") reportAbort();
          return;
        }
        case "tool_execution_start": {
          const start = data as AgentToolStartData;
          const now = nowMs();
          const tool: ToolMessage = {
            id: `tool:${start.toolCallId}`,
            role: "tool",
            toolCallId: start.toolCallId,
            name: start.toolName,
            args: start.args,
            status: "running",
            output: "",
            createdAt: now,
            startedAt: now,
            finishedAt: null,
            error: null,
          };
          setMessages((current) => [...current.filter((entry) => entry.id !== tool.id), tool]);
          if (start.toolName === DECISION_TOOL) beginWaiting();
          return;
        }
        case "tool_execution_update": {
          const update = data as AgentToolUpdateData;
          if (!update.output) return;
          setMessages((current) =>
            current.map((entry) =>
              entry.role === "tool" && entry.toolCallId === update.toolCallId
                ? { ...entry, output: update.output ?? entry.output }
                : entry,
            ),
          );
          return;
        }
        case "tool_execution_end": {
          const end = data as AgentToolEndData;
          const finishedAt = nowMs();
          setMessages((current) =>
            current.map((entry) =>
              entry.role === "tool" && entry.toolCallId === end.toolCallId
                ? {
                    ...entry,
                    status: end.isError ? "error" : "ok",
                    output: end.output ?? entry.output,
                    finishedAt,
                    error: end.isError ? end.output || "工具执行失败" : null,
                  }
                : entry,
            ),
          );
          if (end.toolName === DECISION_TOOL) endWaiting();
          return;
        }
        case "run_error": {
          const { message: reason } = data as AgentRunErrorData;
          stop();
          if (abortingRef.current) {
            finalizeAssistant((message) => ({
              ...message,
              streaming: false,
              thinking: false,
              error: null,
            }));
            reportAbort();
          } else {
            finalizeAssistant((message) => ({
              ...message,
              streaming: false,
              thinking: false,
              error: reason || "agent 运行失败",
            }));
          }
          return;
        }
        case "agent_end": {
          stop();
          finalizeAssistant((message) => ({
            ...message,
            streaming: false,
            thinking: false,
          }));
          if (abortingRef.current) reportAbort();
          abortingRef.current = false;
          return;
        }
        default:
          return;
      }
    },
    [
      beginWaiting,
      endWaiting,
      finalizeAssistant,
      patchAssistant,
      reportAbort,
      startAssistant,
      stop,
    ],
  );

  return {
    messages,
    setMessages,
    appendNotice,
    appendError,
    appendConfirm,
    appendUserMessage,
    clearMessages,
    createId: nextId,
    failAssistant,
    finalizeAssistant,
    resetAssistant,
    resetAbort,
    requestAbort,
    releaseAbort,
    handleEvent,
  };
}
