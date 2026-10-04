import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { agentClient, isTauriRuntime } from "@/lib/agent/client";
import { modeLabel, parseCommand, type CommandAction } from "@/lib/chat/commands";
import type {
  AssistantMessage,
  ChatMessage,
  ErrorMessage,
  NoticeMessage,
  ToolMessage,
  UserMessage,
} from "@/lib/chat/types";
import type {
  AgentMessageEndData,
  AgentRunErrorData,
  AgentRuntimeInfo,
  AgentTextDeltaData,
  AgentToolEndData,
  AgentToolStartData,
  AgentToolUpdateData,
  ChatMode,
  DecisionAnswer,
} from "@shared/protocol";

export interface AgentChatOptions {
  onEditSystemPrompt?: () => void;
}

export interface AgentChat {
  messages: ChatMessage[];
  running: boolean;
  mode: ChatMode;
  runStartedAt: number | null;
  runtime: AgentRuntimeInfo | null;
  bridgeError: string | null;
  configError: string | null;
  send(text: string): void;
  stop(): void;
  answerDecision(toolCallId: string, answers: DecisionAnswer[]): void;
}

export function useAgentChat(options: AgentChatOptions = {}): AgentChat {
  const client = agentClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<ChatMode>("regular");
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<AgentRuntimeInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const runningRef = useRef(false);
  const abortingRef = useRef(false);
  const abortReportedRef = useRef(false);
  const counterRef = useRef(0);
  const assistantIdRef = useRef<string | null>(null);
  const editSystemPromptRef = useRef(options.onEditSystemPrompt);
  editSystemPromptRef.current = options.onEditSystemPrompt;

  const nextId = useCallback(() => `msg-${(counterRef.current += 1)}`, []);

  const appendNotice = useCallback(
    (notice: Omit<NoticeMessage, "id" | "role" | "createdAt">) => {
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "notice", createdAt: Date.now(), ...notice },
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
        createdAt: Date.now(),
      };
      setMessages((current) => [...current, message]);
    },
    [nextId],
  );

  const reportAbort = useCallback(() => {
    if (abortReportedRef.current) return;
    abortReportedRef.current = true;
    appendError("已中止");
  }, [appendError]);

  const setRunningSafe = useCallback((next: boolean) => {
    runningRef.current = next;
    setRunning(next);
  }, []);

  const applyToAssistant = useCallback(
    (patch: (message: AssistantMessage) => AssistantMessage) => {
      setMessages((current) => {
        const id = assistantIdRef.current;
        if (id) {
          const index = current.findIndex((message) => message.id === id);
          const found = current[index];
          if (index >= 0 && found.role === "assistant") {
            const next = current.slice();
            next[index] = patch(found);
            return next;
          }
        }
        const created: AssistantMessage = {
          id: nextId(),
          role: "assistant",
          text: "",
          createdAt: Date.now(),
          startedAt: Date.now(),
          streaming: true,
          thinking: true,
          error: null,
        };
        assistantIdRef.current = created.id;
        return [...current, patch(created)];
      });
    },
    [nextId],
  );

  const finishAssistant = useCallback((patch: (message: AssistantMessage) => AssistantMessage) => {
    const id = assistantIdRef.current;
    assistantIdRef.current = null;
    if (!id) return;
    setMessages((current) => {
      const index = current.findIndex((message) => message.id === id);
      const found = current[index];
      if (index < 0 || found.role !== "assistant") return current;
      const patched = patch(found);
      const next = current.slice();
      if (!patched.text && !patched.error && !patched.streaming) {
        next.splice(index, 1);
        return next;
      }
      next[index] = patched;
      return next;
    });
  }, []);

  const stopStreaming = useCallback(() => {
    setMessages((current) =>
      current.map((message) =>
        message.role === "assistant" && message.streaming
          ? { ...message, streaming: false, thinking: false }
          : message,
      ),
    );
  }, []);

  const handleEvent = useCallback(
    (name: string, data: unknown) => {
      switch (name) {
        case "text_delta": {
          const { delta } = data as AgentTextDeltaData;
          applyToAssistant((message) => ({
            ...message,
            text: message.text + (delta ?? ""),
            thinking: false,
          }));
          return;
        }
        case "thinking_start": {
          applyToAssistant((message) => (message.text ? message : { ...message, thinking: true }));
          return;
        }
        case "message_end": {
          const end = data as AgentMessageEndData;
          if (end.role !== "assistant") return;
          finishAssistant((message) => ({
            ...message,
            streaming: false,
            thinking: false,
            error: errorFor(end),
          }));
          if (end.stopReason === "aborted") reportAbort();
          return;
        }
        case "tool_execution_start": {
          const start = data as AgentToolStartData;
          const tool: ToolMessage = {
            id: `tool:${start.toolCallId}`,
            role: "tool",
            toolCallId: start.toolCallId,
            name: start.toolName,
            args: start.args,
            status: "running",
            output: "",
            createdAt: Date.now(),
            error: null,
          };
          setMessages((current) => [
            ...current.filter((entry) => entry.id !== tool.id),
            tool,
          ]);
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
          setMessages((current) =>
            current.map((entry) =>
              entry.role === "tool" && entry.toolCallId === end.toolCallId
                ? {
                    ...entry,
                    status: end.isError ? "error" : "ok",
                    output: end.output ?? entry.output,
                    error: end.isError ? end.output || "工具执行失败" : null,
                  }
                : entry,
            ),
          );
          return;
        }
        case "run_error": {
          const { message: reason } = data as AgentRunErrorData;
          setRunningSafe(false);
          setRunStartedAt(null);
          if (abortingRef.current) {
            finishAssistant((message) => ({
              ...message,
              streaming: false,
              thinking: false,
              error: null,
            }));
            reportAbort();
          } else {
            finishAssistant((message) => ({
              ...message,
              streaming: false,
              thinking: false,
              error: reason || "agent 运行失败",
            }));
          }
          return;
        }
        case "agent_end": {
          setRunningSafe(false);
          setRunStartedAt(null);
          stopStreaming();
          if (abortingRef.current) reportAbort();
          abortingRef.current = false;
          return;
        }
        default:
          return;
      }
    },
    [appendError, applyToAssistant, finishAssistant, reportAbort, setRunningSafe, stopStreaming],
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      setBridgeError("当前不是 Tauri 运行环境，请用 npm run tauri dev 启动。");
      return;
    }

    const off = client.onRecord((record) => {
      switch (record.type) {
        case "event":
          handleEvent(record.name, record.data);
          return;
        case "closed":
          setRunningSafe(false);
          stopStreaming();
          setBridgeError(record.reason);
          return;
        case "log":
          if (record.level === "error") toast.error(record.message);
          return;
        default:
          return;
      }
    });

    void (async () => {
      try {
        await client.connect();
        await client.waitUntilConnected();
        const hello = await client.hello("world");
        setRuntime(hello.runtime);
        setMode(hello.runtime.mode);
      } catch (error) {
        setBridgeError(describe(error));
      }
    })();

    return off;
  }, [client, handleEvent, setRunningSafe, stopStreaming]);

  const runCommand = useCallback(
    (action: CommandAction) => {
      const failed = (error: unknown) => appendError(describe(error));

      switch (action.type) {
        case "clear":
          client
            .clear()
            .then(() => {
              assistantIdRef.current = null;
              setMessages([]);
            })
            .catch(failed);
          return;
        case "system.show":
          client
            .systemPrompt()
            .then((data) => {
              appendNotice({ title: data.path, text: data.text, error: null });
            })
            .catch(failed);
          return;
        case "system.edit":
          editSystemPromptRef.current?.();
          return;
        case "cwd.show":
          client
            .cwd()
            .then((data) => {
              appendNotice({ title: "工作目录", text: data.path, error: null });
            })
            .catch(failed);
          return;
        case "cwd.set":
          client
            .setCwd(action.path)
            .then((data) => {
              setRuntime((current) => (current ? { ...current, workdir: data.path } : current));
              appendNotice({ title: "工作目录", text: data.path, error: null });
            })
            .catch(failed);
          return;
        case "mode.show":
          appendNotice({
            title: "模式",
            text: `当前为 ${modeLabel(mode)} 模式`,
            error: null,
          });
          return;
        case "mode.set":
          client
            .setMode(action.mode)
            .then(() => {
              setMode(action.mode);
              setRuntime((current) => (current ? { ...current, mode: action.mode } : current));
              appendNotice({
                title: "模式",
                text: `已切换到 ${modeLabel(action.mode)} 模式`,
                error: null,
              });
            })
            .catch(failed);
          return;
        default:
          return;
      }
    },
    [appendError, appendNotice, client, mode],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || runningRef.current) return;

      const now = Date.now();
      const userMessage: UserMessage = {
        id: nextId(),
        role: "user",
        text: trimmed,
        createdAt: now,
        startedAt: now,
      };

      const action = parseCommand(trimmed);
      if (action) {
        setMessages((current) => [...current, userMessage]);
        runCommand(action);
        return;
      }

      abortReportedRef.current = false;
      abortingRef.current = false;

      const assistantId = nextId();
      const assistantMessage: AssistantMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        createdAt: Date.now(),
        startedAt: Date.now(),
        streaming: true,
        thinking: true,
        error: null,
      };
      assistantIdRef.current = assistantId;
      setRunningSafe(true);
      setRunStartedAt(now);
      setMessages((current) => [...current, userMessage, assistantMessage]);

      client.prompt(trimmed).catch((error: unknown) => {
        const reason = describe(error);
        assistantIdRef.current = null;
        setRunningSafe(false);
        setRunStartedAt(null);
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId && entry.role === "assistant"
              ? { ...entry, streaming: false, thinking: false, error: reason }
              : entry,
          ),
        );
      });
    },
    [client, nextId, runCommand, setRunningSafe],
  );

  const stop = useCallback(() => {
    abortingRef.current = true;
    client.abort().catch((error: unknown) => {
      abortingRef.current = false;
      toast.error(describe(error));
    });
  }, [client]);

  const answerDecision = useCallback(
    (toolCallId: string, answers: DecisionAnswer[]) => {
      client
        .answerDecision(toolCallId, answers)
        .catch((error: unknown) => appendError(describe(error)));
    },
    [appendError, client],
  );

  return {
    messages,
    running,
    mode,
    runStartedAt,
    runtime,
    bridgeError,
    configError: runtime?.configError ?? null,
    send,
    stop,
    answerDecision,
  };
}

function errorFor(end: AgentMessageEndData): string | null {
  if (end.stopReason === "error") return end.errorMessage ?? "模型调用失败";
  if (end.stopReason === "aborted") return null;
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
