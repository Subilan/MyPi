import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { agentClient, isTauriRuntime } from "@/lib/agent/client";
import { modeLabel, parseCommand, type CommandAction } from "@/lib/chat/commands";
import {
  buildTree,
  pathEntries,
  toSessionMessages,
  type ChatTree,
} from "@/lib/chat/tree";
import type {
  AssistantMessage,
  ChatMessage,
  ConfirmMessage,
  ErrorMessage,
  NoticeMessage,
  ToolMessage,
  UserMessage,
} from "@/lib/chat/types";
import { formatDateTime, nowMs } from "@/lib/time";
import type {
  AgentAssistantTextData,
  AgentMessageEndData,
  AgentMessageStartData,
  AgentRunErrorData,
  AgentRuntimeInfo,
  AgentSessionSummary,
  AgentToolEndData,
  AgentToolStartData,
  AgentToolUpdateData,
  ChatMode,
  DecisionAnswer,
} from "@shared/protocol";

export interface AgentChatOptions {
  onEditSystemPrompt?: () => void;
}

export interface SessionBrowserState {
  loading: boolean;
  error: string | null;
  sessions: AgentSessionSummary[];
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
  sessionBrowser: SessionBrowserState | null;
  closeSessionBrowser(): void;
  switchSession(target: string): Promise<void>;
  jumpTree: ChatTree | null;
  composerSeed: { text: string; nonce: number } | null;
  openJumpView(): void;
  closeJumpView(): void;
  commitJump(nodeId: string): void;
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
  const [sessionBrowser, setSessionBrowser] = useState<SessionBrowserState | null>(null);
  const [jumpTree, setJumpTree] = useState<ChatTree | null>(null);
  const [composerSeed, setComposerSeed] = useState<{ text: string; nonce: number } | null>(null);

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
    waitingStartedAtRef.current = nowMs();
    setWaitingForUser(true);
  }, []);

  const endWaiting = useCallback(() => {
    const startedAt = waitingStartedAtRef.current;
    if (startedAt === null) return;
    waitingStartedAtRef.current = null;
    pausedMsRef.current += nowMs() - startedAt;
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
        const found = current[index];
        if (index < 0 || found.role !== "assistant") return current;
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
          setRunningSafe(false);
          setRunStartedAt(null);
          clearWaiting();
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
          setRunningSafe(false);
          setRunStartedAt(null);
          clearWaiting();
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
      appendError,
      beginWaiting,
      clearWaiting,
      endWaiting,
      finalizeAssistant,
      patchAssistant,
      reportAbort,
      setRunningSafe,
      startAssistant,
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
          finalizeAssistant((message) => ({
            ...message,
            streaming: false,
            thinking: false,
          }));
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
  }, [client, clearWaiting, finalizeAssistant, handleEvent, setRunningSafe]);

  const loadSessionList = useCallback(async (): Promise<AgentSessionSummary[]> => {
    const data = await client.sessionList();
    return data.sessions;
  }, [client]);

  const openSessionBrowser = useCallback(() => {
    setSessionBrowser({ loading: true, error: null, sessions: [] });
    loadSessionList()
      .then((sessions) => {
        setSessionBrowser((current) =>
          current ? { loading: false, error: null, sessions } : current,
        );
      })
      .catch((error: unknown) => {
        setSessionBrowser((current) =>
          current ? { loading: false, error: describe(error), sessions: [] } : current,
        );
      });
  }, [loadSessionList]);

  const closeSessionBrowser = useCallback(() => setSessionBrowser(null), []);

  const switchSession = useCallback(
    async (target: string): Promise<void> => {
      const list = await loadSessionList();
      const found = resolveSession(list, target);
      if (!found) throw new Error(`找不到会话 "${target}"`);
      const data = await client.switchSession(found.id);
      assistantIdRef.current = null;
      setRunningSafe(false);
      setRunStartedAt(null);
      clearWaiting();
      const tree = buildTree(data.nodes, data.head);
      setMessages([
        ...toSessionMessages(pathEntries(tree, data.head)),
        {
          id: `send-${(counterRef.current += 1)}`,
          role: "notice",
          title: "SESSION",
          text: `已切换到会话 ${data.summary.id}（${formatDateTime(
            data.summary.startedAt,
          )}），接下来的消息会追加到这个会话里。`,
          createdAt: nowMs(),
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
      setSessionBrowser(null);
      setJumpTree(null);
      setComposerSeed(null);
    },
    [clearWaiting, client, loadSessionList, setRunningSafe],
  );

  const openJumpView = useCallback(() => {
    if (runningRef.current || requestedModeRef.current !== null) return;
    client
      .sessionTree()
      .then((data) => setJumpTree(buildTree(data.nodes, data.head)))
      .catch((error: unknown) => appendError(describe(error)));
  }, [appendError, client]);

  const closeJumpView = useCallback(() => setJumpTree(null), []);

  const commitJump = useCallback(
    (nodeId: string) => {
      client
        .sessionJump(nodeId)
        .then((data) => {
          assistantIdRef.current = null;
          setRunningSafe(false);
          setRunStartedAt(null);
          clearWaiting();
          const tree = buildTree(data.nodes, data.head);
          const target = tree.byId.get(nodeId)?.entry;
          setMessages(toSessionMessages(pathEntries(tree, data.head)));
          setJumpTree(null);
          if (target && target.role === "user") {
            setComposerSeed((current) => ({
              text: target.text,
              nonce: (current?.nonce ?? 0) + 1,
            }));
          } else {
            setComposerSeed(null);
          }
        })
        .catch((error: unknown) => {
          setJumpTree(null);
          appendError(describe(error));
        });
    },
    [appendError, clearWaiting, client, setRunningSafe],
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
          openSessionBrowser();
          return;
        case "sessions.switch":
          switchSession(action.target).catch(failed);
          return;
        case "jump":
          if (runningRef.current || requestedModeRef.current !== null) {
            appendError("当前有正在运行或待确认的操作，完成后再跳转");
            return;
          }
          openJumpView();
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
      mode,
      openJumpView,
      openSessionBrowser,
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

      const now = nowMs();
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

      setRunningSafe(true);
      setRunStartedAt(now);
      runBaseRef.current = now;
      pausedMsRef.current = 0;
      setWaitingForUser(false);
      setMessages((current) => [...current, userMessage]);

      client.prompt(trimmed).catch((error: unknown) => {
        const reason = describe(error);
        setRunningSafe(false);
        setRunStartedAt(null);
        clearWaiting();
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
      });
    },
    [appendError, clearWaiting, client, finalizeAssistant, nextId, runCommand, setRunningSafe],
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
    sessionBrowser,
    closeSessionBrowser,
    switchSession,
    jumpTree,
    composerSeed,
    openJumpView,
    closeJumpView,
    commitJump,
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
