import type { AgentEvent } from "@earendil-works/pi-agent-core";
import corePkg from "@earendil-works/pi-agent-core/package.json";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentRecord,
  type AgentRequest,
  type AgentRuntimeInfo,
} from "../../shared/protocol.ts";
import { createAgentHost } from "./agent-host.ts";
import { messageText } from "./session.ts";

const host = createAgentHost(emitEvent);

const info: AgentRuntimeInfo = {
  protocol: AGENT_PROTOCOL_VERSION,
  runtime: `node ${process.version}`,
  platform: `${process.platform} ${process.arch}`,
  coreVersion: `@earendil-works/pi-agent-core ${corePkg.version}`,
  provider: host.provider,
  model: host.model,
  thinkingLevel: host.thinkingLevel,
  settingsPath: host.settingsPath,
  workdir: host.workdir(),
  mode: host.mode(),
  sessionId: host.sessionId(),
  sessionsDir: host.sessionsDir(),
  configError: host.configError,
};

function runtimeInfo(): AgentRuntimeInfo {
  return { ...info, mode: host.mode(), sessionId: host.sessionId() };
}

let buffer = "";
let active = 0;
let closing = false;

function emit(record: AgentRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function log(level: "info" | "warn" | "error", message: string): void {
  process.stderr.write(`[sidecar] ${level}: ${message}\n`);
}

function feed(chunk: string): void {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) continue;
    let request: AgentRequest;
    try {
      request = JSON.parse(trimmed) as AgentRequest;
    } catch {
      emit({ type: "log", level: "error", message: `malformed record: ${trimmed.slice(0, 200)}` });
      continue;
    }
    active += 1;
    void handle(request)
      .catch((error: unknown) => {
        emit({
          type: "response",
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        active -= 1;
        maybeExit();
      });
  }
}

function maybeExit(): void {
  if (closing && active === 0) {
    log("info", "stdin closed, exiting");
    process.exit(0);
  }
}

async function handle(request: AgentRequest): Promise<void> {
  switch (request.type) {
    case "hello": {
      const who = request.name?.trim() || "world";
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: { greeting: `hello ${who}`, runtime: runtimeInfo() },
      });
      return;
    }
    case "state": {
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: { ...host.snapshot(), model: host.model },
      });
      return;
    }
    case "prompt": {
      const text = request.text?.trim();
      if (!text) {
        emit({ type: "response", id: request.id, ok: false, error: "prompt text is empty" });
        return;
      }
      emit({ type: "response", id: request.id, ok: true, data: { accepted: true } });
      try {
        await host.prompt(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", `prompt failed: ${message}`);
        host.recordError(message);
        emit({ type: "event", name: "run_error", data: { message } });
      }
      return;
    }
    case "abort": {
      await host.abort();
      emit({ type: "response", id: request.id, ok: true, data: { aborted: true } });
      return;
    }
    case "clear": {
      await host.clear();
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: { cleared: true, sessionId: host.sessionId() },
      });
      return;
    }
    case "session_list": {
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: { sessions: host.sessions() },
      });
      return;
    }
    case "session_search": {
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: { ids: host.searchSessions(request.query ?? "") },
      });
      return;
    }
    case "session_switch": {
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: await host.switchSession(request.sessionId ?? ""),
      });
      return;
    }
    case "session_tree": {
      emit({ type: "response", id: request.id, ok: true, data: host.tree() });
      return;
    }
    case "session_jump": {
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: await host.jump(request.nodeId ?? ""),
      });
      return;
    }
    case "system_prompt": {
      emit({ type: "response", id: request.id, ok: true, data: host.systemPrompt() });
      return;
    }
    case "system_prompt_save": {
      emit({
        type: "response",
        id: request.id,
        ok: true,
        data: host.saveSystemPrompt(request.text ?? ""),
      });
      return;
    }
    case "cwd": {
      emit({ type: "response", id: request.id, ok: true, data: { path: host.workdir() } });
      return;
    }
    case "cwd_set": {
      const next = host.setWorkdir(request.path ?? "");
      emit({ type: "response", id: request.id, ok: true, data: { path: next } });
      return;
    }
    case "mode_set": {
      const mode = host.setMode(request.mode ?? "regular");
      emit({ type: "response", id: request.id, ok: true, data: { mode } });
      return;
    }
    case "decision_answer": {
      const accepted = request.toolCallId
        ? host.answerDecision(request.toolCallId, request.answers ?? [])
        : false;
      emit({ type: "response", id: request.id, ok: true, data: { accepted } });
      return;
    }
    default: {
      emit({
        type: "response",
        id: request.id,
        ok: false,
        error: `unknown request type: ${String((request as { type: string }).type)}`,
      });
    }
  }
}

function projectEvent(event: AgentEvent): { name: string; data: unknown } | null {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_start" || inner.type === "text_delta" || inner.type === "text_end") {
        return { name: "assistant_text", data: { text: messageText(event.message) } };
      }
      return null;
    }
    case "message_start":
      return { name: event.type, data: { role: event.message.role } };
    case "message_end": {
      const data: Record<string, unknown> = { role: event.message.role };
      if (event.message.role === "assistant") {
        data.stopReason = event.message.stopReason;
        if (event.message.errorMessage) data.errorMessage = event.message.errorMessage;
        data.text = messageText(event.message);
      }
      return { name: event.type, data };
    }
    case "tool_execution_start":
      return {
        name: event.type,
        data: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
      };
    case "tool_execution_update":
      return {
        name: event.type,
        data: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          output: summarizeToolResult(event.partialResult),
        },
      };
    case "tool_execution_end":
      return {
        name: event.type,
        data: {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          output: summarizeToolResult(event.result),
        },
      };
    case "agent_end":
      return { name: event.type, data: {} };
    default:
      return { name: event.type, data: {} };
  }
}

function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const block = part as { type?: string; text?: string; mimeType?: string };
      if (block.type === "text") return block.text ?? "";
      if (block.type === "image") return `[图片 ${block.mimeType ?? "unknown"}]`;
      return "";
    })
    .filter((entry) => entry.length > 0)
    .join("\n");
}

function emitEvent(event: AgentEvent): void {
  const projection = projectEvent(event);
  if (!projection) return;
  emit({ type: "event", name: projection.name, data: projection.data });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", feed);
process.stdin.on("end", () => {
  closing = true;
  maybeExit();
});

log("info", `serving the protocol over stdin/stdout as node ${process.version}`);
if (host.configError) log("error", host.configError);
emit({ type: "ready", runtime: runtimeInfo() });
