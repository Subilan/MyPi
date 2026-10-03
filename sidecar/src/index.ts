import { connect } from "node:net";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import corePkg from "@earendil-works/pi-agent-core/package.json";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentRecord,
  type AgentRequest,
  type AgentRuntimeInfo,
} from "../../shared/protocol.ts";
import { createAgentHost } from "./agent-host.ts";

const bunRuntime = (globalThis as { Bun?: { version: string } }).Bun;
const runtime = bunRuntime ? `bun ${bunRuntime.version}` : `node ${process.version}`;
const host = createAgentHost(emitEvent);

const info: AgentRuntimeInfo = {
  protocol: AGENT_PROTOCOL_VERSION,
  runtime,
  platform: `${process.platform} ${process.arch}`,
  coreVersion: `@earendil-works/pi-agent-core ${corePkg.version}`,
  model: host.model,
  demo: host.demo,
};

let buffer = "";
let writeLine: (line: string) => void = (line) => {
  process.stdout.write(`${line}\n`);
};

function emit(record: AgentRecord): void {
  writeLine(JSON.stringify(record));
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

function serveTcp(port: number, token: string): void {
  const socket = connect({ host: "127.0.0.1", port });
  socket.setEncoding("utf8");
  writeLine = (line) => {
    socket.write(`${line}\n`);
  };
  socket.on("connect", () => {
    emit({ type: "ready", token, runtime: info });
  });
  socket.on("data", feed);
  socket.on("close", () => {
    process.exit(0);
  });
  socket.on("error", (error: Error) => {
    log("error", `socket failed: ${error.message}`);
    process.exit(1);
  });
}

function serveStdio(): void {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", feed);
  emit({ type: "ready", runtime: info });
}

const port = Number(process.env.AGENT_RUNBOOK_PORT ?? "");
const token = process.env.AGENT_RUNBOOK_TOKEN ?? "";

if (Number.isInteger(port) && port > 0) {
  log("info", `connecting to host on 127.0.0.1:${port}`);
  serveTcp(port, token);
} else {
  log("info", "no AGENT_RUNBOOK_PORT set, serving the protocol over stdin/stdout");
  serveStdio();
}
