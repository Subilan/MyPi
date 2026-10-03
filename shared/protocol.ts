export const AGENT_PROTOCOL_VERSION = 1;

export interface AgentRequest {
  id: string;
  type: "hello" | "prompt" | "abort" | "state";
  text?: string;
  name?: string;
}

export interface AgentRuntimeInfo {
  protocol: number;
  runtime: string;
  platform: string;
  coreVersion: string;
  model: string;
  demo: boolean;
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
