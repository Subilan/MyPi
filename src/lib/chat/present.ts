import type { ChatMode } from "@shared/protocol";
import type { ChatMessage, ToolMessage } from "@/lib/chat/types";

const MAX_ARGS_CHARS = 400;

const DELIVER_TOOLS = new Set(["report_success", "report_failure", "request_user_decision"]);

const BASH_DEFAULT_TIMEOUT_MS = 120_000;
const BASH_MIN_TIMEOUT_MS = 1_000;
const BASH_MAX_TIMEOUT_MS = 600_000;

export function argObject(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readDetail(args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "";
  const offset =
    typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : null;
  const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : null;
  if (offset !== null && limit !== null) return `${path}:${offset}-${offset + limit - 1}`;
  if (offset !== null) return `${path}:${offset}+`;
  if (limit !== null) return `${path}:1-${limit}`;
  return path;
}

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  let text: string;
  try {
    text = JSON.stringify(args) ?? "";
  } catch {
    text = String(args);
  }
  return text.length > MAX_ARGS_CHARS ? `${text.slice(0, MAX_ARGS_CHARS)}…` : text;
}

export function bashTimeoutMs(args: unknown): number {
  const value = argObject(args).timeout;
  if (typeof value !== "number" || !Number.isFinite(value)) return BASH_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, BASH_MIN_TIMEOUT_MS), BASH_MAX_TIMEOUT_MS);
}

export function toolDetail(message: ToolMessage): string {
  const args = argObject(message.args);
  if (message.name === "Bash") return typeof args.command === "string" ? args.command : "";
  if (message.name === "Read") return readDetail(args);
  if (message.name === "Edit") return typeof args.path === "string" ? args.path : "";
  if (message.name === "Write") {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    const bytes = new TextEncoder().encode(content).length;
    return path ? `${path} (${formatBytes(bytes)})` : "";
  }
  return formatArgs(message.args);
}

export function isHidden(message: ChatMessage, mode: ChatMode): boolean {
  if (mode !== "deliver") return false;
  if (message.role === "assistant") return !message.error;
  if (message.role === "tool") return !DELIVER_TOOLS.has(message.name);
  return false;
}

const DELIVER_FIELD: Record<string, string> = {
  report_success: "description",
  report_failure: "reason",
};

function decisionPreview(args: unknown): string {
  const questions = argObject(args).questions;
  if (!Array.isArray(questions)) return "";
  return questions
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const question = (entry as Record<string, unknown>).question;
      return typeof question === "string" && question.length > 0 ? [question] : [];
    })
    .join(" / ");
}

export function previewText(message: ChatMessage): string {
  switch (message.role) {
    case "user":
    case "assistant":
    case "error":
      return message.text;
    case "notice":
      return [message.title, message.text].filter((part) => part.length > 0).join(" ");
    case "tool": {
      if (message.name === "request_user_decision") {
        const questions = decisionPreview(message.args);
        if (questions) return questions;
      }
      const field = DELIVER_FIELD[message.name];
      if (field) {
        const value = argObject(message.args)[field];
        if (typeof value === "string" && value.length > 0) return value;
      }
      return [message.name, toolDetail(message)].filter((part) => part.length > 0).join(" ");
    }
    case "confirm":
      return message.text;
  }
}

export function rowSurface(message: ChatMessage): {
  className: string;
  status?: string;
  tone?: string;
} {
  switch (message.role) {
    case "user":
      return { className: "mypi-message-user" };
    case "tool":
      return { className: "mypi-message-tool", status: message.status };
    case "notice":
      return { className: "mypi-message-system", tone: "info" };
    case "error":
      return { className: "mypi-message-system", tone: "critical" };
    case "confirm":
      return {
        className: "mypi-message-system",
        tone:
          message.answer === "yes" ? "success" : message.answer === "no" ? "neutral" : "warning",
      };
    default:
      return { className: "mypi-message-assistant" };
  }
}
