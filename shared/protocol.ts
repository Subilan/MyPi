export const AGENT_PROTOCOL_VERSION = 1;

export type ChatMode = "regular" | "deliver";

export interface DecisionOption {
  label: string;
  description?: string;
}

export interface DecisionQuestion {
  id: string;
  type: "yes_no" | "single" | "multi";
  question: string;
  options?: DecisionOption[];
  show_other_choice?: boolean;
}

export interface DecisionAnswer {
  id: string;
  value: string | string[];
}

export interface AgentRequest {
  id: string;
  type:
    | "hello"
    | "prompt"
    | "abort"
    | "state"
    | "clear"
    | "system_prompt"
    | "system_prompt_save"
    | "cwd"
    | "cwd_set"
    | "mode_set"
    | "decision_answer"
    | "session_list"
    | "session_search"
    | "session_switch"
    | "session_tree"
    | "session_jump";
  text?: string;
  name?: string;
  path?: string;
  mode?: ChatMode;
  toolCallId?: string;
  answers?: DecisionAnswer[];
  sessionId?: string;
  nodeId?: string;
  query?: string;
}

export interface AgentRuntimeInfo {
  protocol: number;
  runtime: string;
  platform: string;
  coreVersion: string;
  provider: string;
  model: string;
  thinkingLevel: string;
  settingsPath: string;
  workdir: string;
  mode: ChatMode;
  sessionId: string;
  sessionsDir: string;
  configError: string | null;
}

export interface AgentHelloData {
  greeting: string;
  runtime: AgentRuntimeInfo;
}

export interface AgentStateData {
  messageCount: number;
  isStreaming: boolean;
  model: string;
}

export interface AgentClearData {
  cleared: boolean;
  sessionId: string;
}

export interface AgentSessionSummary {
  id: string;
  startedAt: number;
  updatedAt: number;
  mode: ChatMode;
  workdir: string;
  userMessages: number;
  assistantMessages: number;
  preview: string;
  path: string;
  current: boolean;
}

export interface AgentSessionListData {
  sessions: AgentSessionSummary[];
}

export interface AgentSessionSearchData {
  ids: string[];
}

export interface SessionNodeBase {
  id: string;
  parent: string | null;
}

export type AgentSessionEntry = SessionNodeBase &
  (
    | { role: "user"; at: number; text: string }
    | { role: "assistant"; at: number; text: string; stopReason?: string; error: string | null }
    | {
        role: "tool";
        at: number;
        toolCallId: string;
        name: string;
        args?: unknown;
        isError: boolean;
        output: string;
        durationMs?: number;
      }
    | { role: "error"; at: number; text: string }
    | { role: "notice"; at: number; title: string; text: string }
  );

export interface AgentSessionData {
  summary: AgentSessionSummary;
  nodes: AgentSessionEntry[];
  head: string | null;
}

export interface AgentPromptFileData {
  path: string;
  text: string;
}

export interface AgentCwdData {
  path: string;
}

export interface AgentModeData {
  mode: ChatMode;
}

export interface AgentDecisionData {
  accepted: boolean;
}

export interface AgentMessageStartData {
  role: string;
}

export interface AgentMessageEndData {
  role: string;
  stopReason?: string;
  errorMessage?: string;
  text?: string;
}

export interface AgentAssistantTextData {
  text: string;
}

export interface AgentRunErrorData {
  message: string;
}

export interface AgentToolStartData {
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

export interface AgentToolUpdateData {
  toolCallId: string;
  toolName: string;
  output?: string;
}

export interface AgentToolEndData {
  toolCallId: string;
  toolName: string;
  isError: boolean;
  output?: string;
}

export interface AgentStatus {
  running: boolean;
  connected: boolean;
  error: string | null;
}

export type AgentRecord =
  | { type: "ready"; runtime: AgentRuntimeInfo }
  | { type: "response"; id: string; ok: true; data?: unknown }
  | { type: "response"; id: string; ok: false; error: string }
  | { type: "event"; name: string; data: unknown }
  | { type: "closed"; reason: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };
