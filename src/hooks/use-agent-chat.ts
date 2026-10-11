import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAgentConnection } from "@/hooks/use-agent-connection";
import { useAgentTranscript } from "@/hooks/use-agent-transcript";
import { useLatestRef } from "@/hooks/use-latest-ref";
import { useRunClock } from "@/hooks/use-run-clock";
import { useSessionBrowser, type SessionBrowserState } from "@/hooks/use-session-browser";
import { agentClient } from "@/lib/agent/client";
import { describe, infoText, resolveSession } from "@/lib/chat/agent-helpers";
import { parseCommand, type CommandAction } from "@/lib/chat/commands";
import { runCommand } from "@/lib/chat/run-command";
import { buildTree, pathEntries, toSessionMessages, type ChatTree } from "@/lib/chat/tree";
import type { ChatMessage } from "@/lib/chat/types";
import { formatDateTime, nowMs } from "@/lib/time";
import type { AgentRecord, AgentRuntimeInfo, ChatMode, DecisionAnswer } from "@shared/protocol";

export interface AgentChatOptions {
  onEditSystemPrompt?: () => void;
  onEditTheme?: () => void;
}

export interface AgentChatTranscript {
  messages: ChatMessage[];
  running: boolean;
  waitingForUser: boolean;
  runStartedAt: number | null;
  confirmPending: boolean;
  send(text: string): void;
  stop(): void;
  answerConfirm(yes: boolean): void;
  answerDecision(toolCallId: string, answers: DecisionAnswer[]): Promise<void>;
}

export interface AgentChatRuntime {
  info: AgentRuntimeInfo | null;
  mode: ChatMode;
  sessionId: string | null;
  bridgeError: string | null;
  configError: string | null;
}

export interface AgentChatSessions {
  browser: SessionBrowserState | null;
  close(): void;
  search(query: string): Promise<string[]>;
  switchTo(target: string): Promise<void>;
}

export interface AgentChatJump {
  tree: ChatTree | null;
  seed: { text: string; nonce: number } | null;
  close(): void;
  commit(nodeId: string): void;
}

export interface AgentChat {
  transcript: AgentChatTranscript;
  runtime: AgentChatRuntime;
  sessions: AgentChatSessions;
  jump: AgentChatJump;
}

export function useAgentChat(options: AgentChatOptions = {}): AgentChat {
  const client = agentClient();
  const clock = useRunClock();
  const transcript = useAgentTranscript(clock);
  const browser = useSessionBrowser(client);
  const [mode, setMode] = useState<ChatMode>("regular");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [jumpTree, setJumpTree] = useState<ChatTree | null>(null);
  const [composerSeed, setComposerSeed] = useState<{ text: string; nonce: number } | null>(null);
  const requestedModeRef = useRef<ChatMode | null>(null);
  const editSystemPromptRef = useLatestRef(options.onEditSystemPrompt);
  const editThemeRef = useLatestRef(options.onEditTheme);

  const {
    messages,
    setMessages,
    appendNotice,
    appendError,
    appendConfirm,
    appendUserMessage,
    clearMessages,
    createId,
    failAssistant,
    finalizeAssistant,
    resetAssistant,
    resetAbort,
    requestAbort,
    releaseAbort,
    handleEvent,
  } = transcript;

  const {
    running,
    waitingForUser,
    runStartedAt,
    runningRef,
    start,
    stop: stopClock,
  } = clock;

  const {
    state: sessionBrowser,
    open: openSessionBrowser,
    close: closeSessionBrowser,
    load: loadSessions,
    search: searchSessions,
  } = browser;

  const connection = useAgentConnection(client, {
    onRecord: (record: AgentRecord) => {
      switch (record.type) {
        case "event":
          handleEvent(record.name, record.data);
          return;
        case "closed":
          stopClock();
          finalizeAssistant((message) => ({ ...message, streaming: false, thinking: false }));
          return;
        case "log":
          if (record.level === "error") toast.error(record.message);
          return;
        default:
          return;
      }
    },
    onReady: (runtime) => {
      setMode(runtime.mode);
      setSessionId(runtime.sessionId);
    },
  });
  const { runtime, setRuntime, bridgeError, configError } = connection;

  const openJumpView = useCallback(() => {
    client
      .sessionTree()
      .then((data) => setJumpTree(buildTree(data.nodes, data.head)))
      .catch((error: unknown) => appendError(describe(error)));
  }, [appendError, client]);

  const closeJumpView = useCallback(() => setJumpTree(null), []);

  const switchSession = useCallback(
    async (target: string): Promise<void> => {
      const list = await loadSessions();
      const found = resolveSession(list, target);
      if (!found) throw new Error(`找不到会话 "${target}"`);
      const data = await client.switchSession(found.id);
      resetAssistant();
      stopClock();
      const tree = buildTree(data.nodes, data.head);
      setMessages([
        ...toSessionMessages(pathEntries(tree, data.head)),
        {
          id: createId(),
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
        current ? { ...current, sessionId: data.summary.id, mode: data.summary.mode } : current,
      );
      closeSessionBrowser();
      setJumpTree(null);
      setComposerSeed(null);
    },
    [
      client,
      closeSessionBrowser,
      createId,
      loadSessions,
      resetAssistant,
      setMessages,
      setRuntime,
      stopClock,
    ],
  );

  const commitJump = useCallback(
    (nodeId: string) => {
      client
        .sessionJump(nodeId)
        .then((data) => {
          resetAssistant();
          stopClock();
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
    [appendError, client, resetAssistant, setMessages, stopClock],
  );

  const dispatchCommand = useCallback(
    (action: CommandAction) => {
      runCommand(action, {
        client,
        appendNotice,
        appendError,
        appendConfirm,
        editSystemPrompt: () => editSystemPromptRef.current?.(),
        editTheme: () => editThemeRef.current?.(),
        info: infoText(runtime, mode, running),
        openSessionBrowser,
        switchSession,
        openJumpView,
        mode,
        runningRef,
        requestedModeRef,
        setRuntime,
        setSessionId,
        clearMessages,
        resetAssistant,
      });
    },
    [
      appendConfirm,
      appendError,
      appendNotice,
      clearMessages,
      client,
      editSystemPromptRef,
      editThemeRef,
      mode,
      openJumpView,
      openSessionBrowser,
      resetAssistant,
      running,
      runningRef,
      runtime,
      setRuntime,
      switchSession,
    ],
  );

  const settleConfirm = useCallback(
    (answer: "yes" | "no") => {
      setMessages((current) =>
        current.map((message) =>
          message.role === "confirm" && message.answer === null
            ? { ...message, answer }
            : message,
        ),
      );
    },
    [setMessages],
  );

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
    [appendError, client, setRuntime, settleConfirm],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || runningRef.current || requestedModeRef.current !== null) return;

      const action = parseCommand(trimmed);
      appendUserMessage(trimmed);
      if (action) {
        dispatchCommand(action);
        return;
      }

      resetAbort();
      start();
      client.prompt(trimmed).catch((error: unknown) => {
        stopClock();
        failAssistant(describe(error));
      });
    },
    [
      appendUserMessage,
      client,
      dispatchCommand,
      failAssistant,
      resetAbort,
      runningRef,
      start,
      stopClock,
    ],
  );

  const stop = useCallback(() => {
    requestAbort();
    client.abort().catch((error: unknown) => {
      releaseAbort();
      toast.error(describe(error));
    });
  }, [client, releaseAbort, requestAbort]);

  const answerDecision = useCallback(
    async (toolCallId: string, answers: DecisionAnswer[]): Promise<void> => {
      try {
        await client.answerDecision(toolCallId, answers);
      } catch (error) {
        appendError(describe(error));
        throw error;
      }
    },
    [appendError, client],
  );

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

  return {
    transcript: {
      messages,
      running,
      waitingForUser,
      runStartedAt,
      confirmPending,
      send,
      stop,
      answerConfirm,
      answerDecision,
    },
    runtime: {
      info: runtime,
      mode,
      sessionId,
      bridgeError,
      configError,
    },
    sessions: {
      browser: sessionBrowser,
      close: closeSessionBrowser,
      search: searchSessions,
      switchTo: switchSession,
    },
    jump: {
      tree: jumpTree,
      seed: composerSeed,
      close: closeJumpView,
      commit: commitJump,
    },
  };
}
