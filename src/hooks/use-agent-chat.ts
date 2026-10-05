import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { agentClient, isTauriRuntime } from "@/lib/agent/client";
import { modeLabel, parseCommand, type CommandAction } from "@/lib/chat/commands";
import type {
  AssistantMessage,
  ChatMessage,
  ConfirmMessage,
  ErrorMessage,
  NoticeMessage,
  ToolMessage,
  UserMessage,
} from "@/lib/chat/types";
import type {
  AgentMessageEndData,
  AgentRunErrorData,
  AgentRuntimeInfo,
  AgentSessionEntry,
  AgentSessionSummary,
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
  waitingForUser: boolean;
  mode: ChatMode;
  runStartedAt: number | null;
  runtime: AgentRuntimeInfo | null;
  bridgeError: string | null;
  configError: string | null;
  send(text: string): void;
  stop(): void;
  confirmPending: boolean;
  answerConfirm(yes: boolean): void;
  answerDecision(toolCallId: string, answers: DecisionAnswer[]): void;
  sessionId: string | null;
}

const DECISION_TOOL = "request_user_decision";

export function useAgentChat(options: AgentChatOptions = {}): AgentChat {
  const client = agentClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [waitingForUser, setWaitingForUser] = useState(false);
  const [mode, setMode] = useState<ChatMode>("regular");
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runtime, setRuntime] = useState<AgentRuntimeInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const runningRef = useRef(false);
  const runBaseRef = useRef<number | null>(null);
  const pausedMsRef = useRef(0);
  const waitingStartedAtRef = useRef<number | null>(null);
  const abortingRef = useRef(false);
  const abortReportedRef = useRef(false);
  const requestedModeRef = useRef<ChatMode | null>(null);
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

  const appendConfirm = useCallback(
    (confirm: Omit<ConfirmMessage, "id" | "role" | "createdAt" | "answer">) => {
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "confirm", createdAt: Date.now(), answer: null, ...confirm },
      ]);
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

  const beginWaiting = useCallback(() => {
    if (waitingStartedAtRef.current !== null) return;
    waitingStartedAtRef.current = Date.now();
    setWaitingForUser(true);
  }, []);

  const endWaiting = useCallback(() => {
    const startedAt = waitingStartedAtRef.current;
    if (startedAt === null) return;
    waitingStartedAtRef.current = null;
    pausedMsRef.current += Date.now() - startedAt;
    const base = runBaseRef.current;
    if (base !== null) setRunStartedAt(base + pausedMsRef.current);
    setWaitingForUser(false);
  }, []);

  const clearWaiting = useCallback(() => {
    waitingStartedAtRef.current = null;
    pausedMsRef.current = 0;
    runBaseRef.current = null;
    setWaitingForUser(false);
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

  const finishAssistant = useCallback(
    (patch: (message: AssistantMessage) => AssistantMessage, text?: string) => {
      const id = assistantIdRef.current;
      assistantIdRef.current = null;
      setMessages((current) => {
        let lastUser = -1;
        for (let index = current.length - 1; index >= 0; index -= 1) {
          if (current[index].role === "user") {
            lastUser = index;
            break;
          }
        }
        const head = current.slice(0, lastUser + 1);
        const tail = current.slice(lastUser + 1);
        const separated = tail.some((entry) => entry.role === "tool");
        let anchor = id === null ? -1 : tail.findIndex((entry) => entry.id === id);
        if (anchor < 0) {
          for (let index = tail.length - 1; index >= 0; index -= 1) {
            if (tail[index].role === "assistant") {
              anchor = index;
              break;
            }
          }
        }
        const target = anchor >= 0 ? tail[anchor] : undefined;
        if (!target || target.role !== "assistant") return current;
        const patched = patch(text === undefined ? target : { ...target, text });
        const drop = !patched.text && !patched.error && !patched.streaming;
        const next: ChatMessage[] = [];
        tail.forEach((entry, index) => {
          if (entry.role !== "assistant") {
            next.push(entry);
            return;
          }
          if (index === anchor) {
            if (!drop) next.push(patched);
            return;
          }
          if (separated) next.push(entry);
        });
        return [...head, ...next];
      });
    },
    [],
  );

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
          finishAssistant(
            (message) => ({
              ...message,
              streaming: false,
              thinking: false,
              error: errorFor(end),
            }),
            typeof end.text === "string" ? end.text : undefined,
          );
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
          if (end.toolName === DECISION_TOOL) endWaiting();
          return;
        }
        case "run_error": {
          const { message: reason } = data as AgentRunErrorData;
          setRunningSafe(false);
          setRunStartedAt(null);
          clearWaiting();
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
          clearWaiting();
          stopStreaming();
          if (abortingRef.current) reportAbort();
          abortingRef.current = false;
          return;
        }
        default:
          return;
      }
    },
    [
      appendError,
      applyToAssistant,
      beginWaiting,
      clearWaiting,
      endWaiting,
      finishAssistant,
      reportAbort,
      setRunningSafe,
      stopStreaming,
    ],
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
          clearWaiting();
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
        setSessionId(hello.runtime.sessionId);
      } catch (error) {
        setBridgeError(describe(error));
      }
    })();

    return off;
  }, [client, clearWaiting, handleEvent, setRunningSafe, stopStreaming]);

  const loadSessionList = useCallback(async (): Promise<AgentSessionSummary[]> => {
    const data = await client.sessionList();
    return data.sessions;
  }, [client]);

  const switchSession = useCallback(
    (target: string) => {
      const failed = (error: unknown) => appendError(describe(error));
      loadSessionList()
        .then(async (list) => {
          const found = resolveSession(list, target);
          if (!found) throw new Error(`找不到会话 "${target}"，用 /sessions 查看列表`);
          const data = await client.switchSession(found.id);
          assistantIdRef.current = null;
          setRunningSafe(false);
          setRunStartedAt(null);
          clearWaiting();
          setMessages([
            ...toSessionMessages(data.entries),
            {
              id: `send-${(counterRef.current += 1)}`,
              role: "notice",
              title: "SESSION",
              text: `已切换到会话 ${data.summary.id}（${sessionTimeFormatter.format(
                new Date(data.summary.startedAt),
              )}），接下来的消息会追加到这个会话里。`,
              createdAt: Date.now(),
              error: null,
            },
          ]);
          setMode(data.summary.mode);
          setSessionId(data.summary.id);
          setRuntime((current) =>
            current
              ? { ...current, sessionId: data.summary.id, mode: data.summary.mode }
              : current,
          );
        })
        .catch(failed);
    },
    [appendError, clearWaiting, client, loadSessionList, setRunningSafe],
  );

  const runCommand = useCallback(
    (action: CommandAction) => {
      const failed = (error: unknown) => appendError(describe(error));

      switch (action.type) {
        case "clear":
          client
            .clear()
            .then((data) => {
              assistantIdRef.current = null;
              setSessionId(data.sessionId);
              setRuntime((current) =>
                current ? { ...current, sessionId: data.sessionId } : current,
              );
              setMessages([]);
            })
            .catch(failed);
          return;
        case "system.show":
          client
            .systemPrompt()
            .then((data) => {
              appendNotice({
                title: "SYSTEM PROMPT",
                text: `${data.path}\n\n${data.text}`,
                error: null,
              });
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
              appendNotice({ title: "CWD", text: data.path, error: null });
            })
            .catch(failed);
          return;
        case "cwd.set":
          client
            .setCwd(action.path)
            .then((data) => {
              setRuntime((current) => (current ? { ...current, workdir: data.path } : current));
              appendNotice({ title: "CWD", text: data.path, error: null });
            })
            .catch(failed);
          return;
        case "info.show":
          appendNotice({
            title: "INFO",
            text: infoText(runtime, mode, running),
            error: null,
          });
          return;
        case "sessions.list":
          loadSessionList()
            .then((list) => {
              appendNotice({
                title: "SESSIONS",
                text: formatSessionList(list, runtime?.sessionsDir ?? ""),
                error: null,
              });
            })
            .catch(failed);
          return;
        case "sessions.switch":
          switchSession(action.target);
          return;
        case "mode.show":
          appendNotice({
            title: "MODE",
            text: `当前为 ${modeLabel(mode)} 模式`,
            error: null,
          });
          return;
        case "mode.set":
          if (action.mode === mode) {
            appendNotice({
              title: "MODE",
              text: `当前为 ${modeLabel(mode)} 模式`,
              error: null,
            });
            return;
          }
          if (requestedModeRef.current !== null) return;
          requestedModeRef.current = action.mode;
          appendConfirm({
            title: "CONFIRMATION",
            text: `切换模式会重建 Agent，并把不属于 ${modeLabel(action.mode)} 模式的历史工具调用从模型上下文里移除；聊天记录本身保留。\n确认切换到 ${modeLabel(action.mode)} 模式？`,
            switchTo: action.mode,
          });
          return;
        default:
          return;
      }
    },
    [
      appendConfirm,
      appendError,
      appendNotice,
      clearWaiting,
      client,
      loadSessionList,
      mode,
      running,
      runtime,
      setRunningSafe,
      switchSession,
    ],
  );

  const settleConfirm = useCallback((answer: "yes" | "no") => {
    setMessages((current) =>
      current.map((message) =>
        message.role === "confirm" && message.answer === null
          ? { ...message, answer }
          : message,
      ),
    );
  }, []);

  const answerConfirm = useCallback(
    (yes: boolean) => {
      const target = requestedModeRef.current;
      if (target === null) return;
      requestedModeRef.current = null;
      if (!yes) {
        settleConfirm("no");
        return;
      }
      client
        .setMode(target)
        .then(() => {
          setMode(target);
          setRuntime((current) => (current ? { ...current, mode: target } : current));
          settleConfirm("yes");
        })
        .catch((error: unknown) => {
          requestedModeRef.current = target;
          appendError(describe(error));
        });
    },
    [appendError, client, settleConfirm],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || runningRef.current || requestedModeRef.current !== null) return;

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
      runBaseRef.current = now;
      pausedMsRef.current = 0;
      setWaitingForUser(false);
      setMessages((current) => [...current, userMessage, assistantMessage]);

      client.prompt(trimmed).catch((error: unknown) => {
        const reason = describe(error);
        assistantIdRef.current = null;
        setRunningSafe(false);
        setRunStartedAt(null);
        clearWaiting();
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId && entry.role === "assistant"
              ? { ...entry, streaming: false, thinking: false, error: reason }
              : entry,
          ),
        );
      });
    },
    [client, clearWaiting, nextId, runCommand, setRunningSafe],
  );

  const stop = useCallback(() => {
    abortingRef.current = true;
    client.abort().catch((error: unknown) => {
      abortingRef.current = false;
      toast.error(describe(error));
    });
  }, [client]);

  const confirmPending = messages.some(
    (message) => message.role === "confirm" && message.answer === null,
  );

  useEffect(() => {
    if (!confirmPending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        event.preventDefault();
        answerConfirm(true);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        answerConfirm(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answerConfirm, confirmPending]);

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
    waitingForUser,
    mode,
    runStartedAt,
    runtime,
    bridgeError,
    configError: runtime?.configError ?? null,
    send,
    stop,
    confirmPending,
    answerConfirm,
    answerDecision,
    sessionId,
  };
}

function infoText(
  runtime: AgentRuntimeInfo | null,
  mode: ChatMode,
  running: boolean,
): string {
  if (!runtime) return "尚未连接到 sidecar。";
  return [
    `模型：${runtime.provider}/${runtime.model}`,
    `模式：${modeLabel(mode)}`,
    `状态：${running ? "running" : "idle"}`,
    `思考级别：${runtime.thinkingLevel}`,
    `工作目录：${runtime.workdir}`,
    `会话：${runtime.sessionId}`,
    `会话目录：${runtime.sessionsDir}`,
    `运行时：${runtime.runtime} · ${runtime.platform}`,
    `核心：${runtime.coreVersion}`,
    `设置：${runtime.settingsPath}`,
  ].join("\n");
}

function errorFor(end: AgentMessageEndData): string | null {
  if (end.stopReason === "error") return end.errorMessage ?? "模型调用失败";
  if (end.stopReason === "aborted") return null;
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveSession(
  sessions: AgentSessionSummary[],
  target: string,
): AgentSessionSummary | null {
  const trimmed = target.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number.parseInt(trimmed, 10) - 1;
    return sessions[index] ?? null;
  }
  const exact = sessions.find((session) => session.id === trimmed);
  if (exact) return exact;
  const prefix = sessions.filter((session) => session.id.startsWith(trimmed));
  return prefix.length === 1 ? prefix[0] : null;
}

function toSessionMessages(entries: AgentSessionEntry[]): ChatMessage[] {
  return entries
    .filter(
      (entry) => entry.role !== "assistant" || entry.text.length > 0 || entry.error !== null,
    )
    .map((entry, index): ChatMessage => {
      switch (entry.role) {
        case "user":
          return {
            id: `history-${index}`,
            role: "user",
            text: entry.text,
            createdAt: entry.at,
            startedAt: entry.at,
          };
        case "assistant":
          return {
            id: `history-${index}`,
            role: "assistant",
            text: entry.text,
            createdAt: entry.at,
            startedAt: entry.at,
            streaming: false,
            thinking: false,
            error: entry.error,
          };
        case "tool":
          return {
            id: `tool:${entry.toolCallId}`,
            role: "tool",
            toolCallId: entry.toolCallId,
            name: entry.name,
            args: entry.args,
            status: entry.isError ? "error" : "ok",
            output: entry.output,
            createdAt: entry.at,
            error: entry.isError ? entry.output || "工具执行失败" : null,
          };
        case "error":
          return { id: `history-${index}`, role: "error", text: entry.text, createdAt: entry.at };
        case "notice":
          return {
            id: `history-${index}`,
            role: "notice",
            title: entry.title,
            text: entry.text,
            createdAt: entry.at,
            error: null,
          };
      }
    });
}

const sessionTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatSessionList(sessions: AgentSessionSummary[], dir: string): string {
  const lines = sessions.map((session, index) => {
    const current = session.current ? "  ← 当前" : "";
    const preview = session.preview || "(还没有消息)";
    return `${index + 1}. ${session.id}${current}\n   ${sessionTimeFormatter.format(
      new Date(session.startedAt),
    )} · ${session.userMessages} 问 / ${session.assistantMessages} 答 · ${preview}`;
  });
  const head = lines.length > 0 ? lines.join("\n") : "还没有会话。";
  const tail = [
    "用 /sessions <序号> 切换过去继续聊，新消息会追加到那个会话。",
    `会话文件：${dir}`,
  ].join("\n");
  return `${head}\n\n${tail}`;
}
