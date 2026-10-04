export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  createdAt: number;
  startedAt: number;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  text: string;
  createdAt: number;
  startedAt: number;
  streaming: boolean;
  thinking: boolean;
  error: string | null;
}

export interface NoticeMessage {
  id: string;
  role: "notice";
  title: string;
  text: string;
  createdAt: number;
  error: string | null;
}

export interface ErrorMessage {
  id: string;
  role: "error";
  text: string;
  createdAt: number;
}

export interface ToolMessage {
  id: string;
  role: "tool";
  toolCallId: string;
  name: string;
  args: unknown;
  status: "running" | "ok" | "error";
  output: string;
  createdAt: number;
  error: string | null;
}

export type ChatMessage = UserMessage | AssistantMessage | NoticeMessage | ErrorMessage | ToolMessage;
