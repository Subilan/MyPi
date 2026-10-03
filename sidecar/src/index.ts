import type { AgentEvent } from "@earendil-works/pi-agent-core";
import corePkg from "@earendil-works/pi-agent-core/package.json";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentRecord,
  type AgentRequest,
  type AgentRuntimeInfo,
} from "../../shared/protocol.ts";
import { createAgentHost } from "./agent-host.ts";

const host = createAgentHost(emitEvent);

const info: AgentRuntimeInfo = {
  protocol: AGENT_PROTOCOL_VERSION,
  runtime: `node ${process.version}`,
  platform: `${process.platform} ${process.arch}`,
  coreVersion: `@earendil-works/pi-agent-core ${corePkg.version}`,
  model: host.model,
  demo: host.demo,
};

let buffer = "";

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
    void handle(request).catch((error: unknown) => {
      emit({
        type: "response",
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
        data: { greeting: `hello ${who}`, runtime: info },
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
      await host.prompt(text);
      return;
    }
    case "abort": {
      await host.abort();
      emit({ type: "response", id: request.id, ok: true, data: { aborted: true } });
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

function projectEvent(event: AgentEvent): { name: string; data: unknown } {
  if (event.type === "message_update") {
    const inner = event.assistantMessageEvent;
    if (inner.type === "text_delta") {
      return { name: "text_delta", data: { delta: inner.delta } };
    }
    if (inner.type === "thinking_delta") {
      return { name: "thinking_delta", data: { delta: inner.delta } };
    }
    return { name: inner.type, data: {} };
  }
  if (event.type === "message_end") {
    return { name: event.type, data: { role: event.message.role } };
  }
  if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
    return { name: event.type, data: { toolName: event.toolName } };
  }
  return { name: event.type, data: {} };
}

function emitEvent(event: AgentEvent): void {
  const { name, data } = projectEvent(event);
  emit({ type: "event", name, data });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", feed);
process.stdin.on("end", () => {
  log("info", "stdin closed, exiting");
  process.exit(0);
});

log("info", `serving the protocol over stdin/stdout as node ${process.version}`);
emit({ type: "ready", runtime: info });
