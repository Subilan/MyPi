export const AGENT_PROTOCOL_VERSION = 1;

export type ChatMode = "regular" | "deliver";

export interface DecisionQuestion {
  id: string;
  type: "yes_no" | "single" | "multi";
  question: string;
  options?: string[];
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
    | "decision_answer";
  text?: string;
  name?: string;
  path?: string;
  mode?: ChatMode;
  toolCallId?: string;
  answers?: DecisionAnswer[];
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
}

export interface AgentTextDeltaData {
  delta: string;
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
