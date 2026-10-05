import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentSessionData,
  AgentSessionEntry,
  AgentSessionSummary,
  ChatMode,
} from "../../shared/protocol.ts";
import { resolveSettingsPath } from "./settings.ts";

const MAX_LIST = 50;
const PREVIEW_CHARS = 60;
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function resolveSessionsDir(): string {
  const override = process.env.AGENT_RUNBOOK_SESSIONS?.trim();
  if (override) return override;
  return path.join(path.dirname(resolveSettingsPath()), "sessions");
}

interface SessionHeader {
  kind: "session";
  id: string;
  at: number;
  mode: ChatMode;
  workdir: string;
  provider: string;
  model: string;
}

type StoredRecord =
  | SessionHeader
  | { kind: "user"; at: number; message: AgentMessage }
  | { kind: "assistant"; at: number; message: AgentMessage }
  | { kind: "tool"; at: number; message: AgentMessage }
  | { kind: "delta_mismatch"; at: number; delta: string; final: string }
  | { kind: "error"; at: number; text: string }
  | { kind: "mode"; at: number; mode: ChatMode }
  | { kind: "workdir"; at: number; path: string };

export interface SessionMeta {
  mode: ChatMode;
  workdir: string;
  provider: string;
  model: string;
}

export interface SessionData extends AgentSessionData {
  history: AgentMessage[];
}

export class SessionStore {
  #dir: string;
  #id: string;
  #meta: SessionMeta | null = null;
  #started = false;
  #pendingText: string | null = null;
  #warned = false;

  constructor(dir: string = resolveSessionsDir()) {
    this.#dir = dir;
    this.#id = newSessionId();
  }

  get dir(): string {
    return this.#dir;
  }

  get id(): string {
    return this.#id;
  }

  file(id: string = this.#id): string {
    return path.join(this.#dir, `${id}.jsonl`);
  }

  start(meta: SessionMeta): void {
    this.#id = newSessionId();
    this.#meta = { ...meta };
    this.#started = false;
    this.#pendingText = null;
  }

  resume(id: string): void {
    const exists = existsSync(this.file(id));
    if (!exists) {
      if (id === this.#id) return;
      throw new Error(`找不到会话 ${id}`);
    }
    this.#id = id;
    this.#meta = null;
    this.#started = true;
    this.#pendingText = null;
  }

  user(text: string): void {
    if (!text) return;
    this.#pendingText = null;
    const at = Date.now();
    this.#write({
      kind: "user",
      at,
      message: { role: "user", content: [{ type: "text", text }], timestamp: at },
    });
  }

  event(event: AgentEvent): void {
    switch (event.type) {
      case "message_start": {
        if (event.message.role === "assistant") this.#pendingText = "";
        return;
      }
      case "message_update": {
        const inner = event.assistantMessageEvent;
        if (inner.type === "text_delta" && this.#pendingText !== null) {
          this.#pendingText += inner.delta;
        }
        return;
      }
      case "message_end": {
        if (event.message.role !== "assistant") return;
        const deltaText = this.#pendingText ?? "";
        this.#pendingText = null;
        const message = event.message;
        const content = message.content.filter((part) => part.type !== "thinking");
        if (content.length === 0 && !message.errorMessage) return;
        const finalText = messageText(message);
        if (deltaText !== finalText) {
          this.#write({ kind: "delta_mismatch", at: Date.now(), delta: deltaText, final: finalText });
          process.stderr.write(
            `[sidecar] warn: 流式文本与最终文本不一致（delta ${deltaText.length} 字符，final ${finalText.length} 字符），已记入会话\n`,
          );
        }
        this.#write({
          kind: "assistant",
          at: message.timestamp,
          message: { ...message, content },
        });
        return;
      }
      case "turn_end": {
        for (const result of event.toolResults) {
          this.#write({ kind: "tool", at: result.timestamp, message: result });
        }
        return;
      }
      default:
        return;
    }
  }

  error(text: string): void {
    if (!text) return;
    this.#write({ kind: "error", at: Date.now(), text });
  }

  mode(mode: ChatMode): void {
    this.#write({ kind: "mode", at: Date.now(), mode });
  }

  workdir(target: string): void {
    this.#write({ kind: "workdir", at: Date.now(), path: target });
  }

  list(): AgentSessionSummary[] {
    const summaries = this.#files()
      .slice(0, MAX_LIST)
      .flatMap((id) => {
        try {
          return [this.#summarize(id)];
        } catch {
          return [];
        }
      });
    const current = this.#currentSummary();
    return [current, ...summaries.filter((entry) => entry.id !== current.id)];
  }

  read(id: string): SessionData {
    if (!ID_PATTERN.test(id)) throw new Error(`非法的会话 id：${id}`);
    const file = this.file(id);
    if (!existsSync(file)) {
      if (id === this.#id) return { summary: this.#currentSummary(), entries: [], history: [] };
      throw new Error(`找不到会话 ${id}`);
    }
    const records = this.#parse(file);
    const entries: AgentSessionEntry[] = [];
    const history: AgentMessage[] = [];
    const argsByCall = new Map<string, unknown>();
    for (const record of records) {
      switch (record.kind) {
        case "user": {
          if (record.message.role === "user") {
            entries.push({ role: "user", at: record.at, text: messageText(record.message) });
            history.push(record.message);
          }
          break;
        }
        case "assistant": {
          const message = record.message;
          if (message.role === "assistant") {
            for (const part of message.content) {
              if (part.type === "toolCall") argsByCall.set(part.id, part.arguments);
            }
            entries.push({
              role: "assistant",
              at: record.at,
              text: messageText(message),
              stopReason: message.stopReason,
              error: message.errorMessage ?? null,
            });
            history.push(message);
          }
          break;
        }
        case "tool": {
          const message = record.message;
          if (message.role === "toolResult") {
            entries.push({
              role: "tool",
              at: record.at,
              toolCallId: message.toolCallId,
              name: message.toolName,
              args: argsByCall.get(message.toolCallId),
              isError: message.isError,
              output: messageText(message, true),
            });
            history.push(message);
          }
          break;
        }
        case "error":
          entries.push({ role: "error", at: record.at, text: record.text });
          break;
        case "delta_mismatch":
          entries.push({
            role: "notice",
            at: record.at,
            title: "DELTA MISMATCH",
            text: ["流式文本与最终文本不一致。", "", "delta：", record.delta, "", "final：", record.final].join(
              "\n",
            ),
          });
          break;
        case "mode":
          entries.push({ role: "notice", at: record.at, title: "MODE", text: record.mode });
          break;
        case "workdir":
          entries.push({ role: "notice", at: record.at, title: "CWD", text: record.path });
          break;
        default:
          break;
      }
    }
    return { summary: this.#summarize(id, records), entries, history };
  }

  #files(): string[] {
    try {
      return readdirSync(this.#dir)
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -".jsonl".length))
        .filter((id) => ID_PATTERN.test(id))
        .sort((a, b) => b.localeCompare(a));
    } catch {
      return [];
    }
  }

  #parse(file: string): StoredRecord[] {
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        const trimmed = line.trim();
        if (!trimmed) return [];
        try {
          return [JSON.parse(trimmed) as StoredRecord];
        } catch {
          return [];
        }
      });
  }

  #summarize(id: string, records?: StoredRecord[]): AgentSessionSummary {
    const file = this.file(id);
    const parsed = records ?? this.#parse(file);
    const header = parsed.find((record): record is SessionHeader => record.kind === "session");
    let mode = header?.mode ?? "regular";
    let userMessages = 0;
    let assistantMessages = 0;
    let preview = "";
    let lastAt = header?.at ?? 0;
    for (const record of parsed) {
      lastAt = Math.max(lastAt, record.at);
      if (record.kind === "user") {
        userMessages += 1;
        if (!preview) preview = clip(messageText(record.message));
      }
      if (record.kind === "assistant") assistantMessages += 1;
      if (record.kind === "mode") mode = record.mode;
    }
    const mtime = statSync(file).mtimeMs;
    return {
      id,
      startedAt: header?.at ?? mtime,
      updatedAt: Math.max(mtime, lastAt),
      mode,
      workdir: header?.workdir ?? homedir(),
      userMessages,
      assistantMessages,
      preview,
      path: file,
      current: id === this.#id,
    };
  }

  #currentSummary(): AgentSessionSummary {
    const file = this.file();
    if (existsSync(file)) {
      const summary = this.#summarize(this.#id);
      return { ...summary, current: true };
    }
    return {
      id: this.#id,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      mode: this.#meta?.mode ?? "regular",
      workdir: this.#meta?.workdir ?? homedir(),
      userMessages: 0,
      assistantMessages: 0,
      preview: "",
      path: file,
      current: true,
    };
  }

  #write(record: StoredRecord): void {
    if (!this.#started) {
      const meta = this.#meta;
      if (meta) this.#emit({ kind: "session", id: this.#id, at: Date.now(), ...meta });
    }
    this.#emit(record);
  }

  #emit(record: StoredRecord): void {
    try {
      mkdirSync(this.#dir, { recursive: true });
      appendFileSync(this.file(), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      this.#started = true;
    } catch (error) {
      if (this.#warned) return;
      this.#warned = true;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[sidecar] warn: 会话记录写入失败（${message}），本次运行不再重试\n`);
    }
  }
}

function newSessionId(now: Date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const suffix = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `${stamp}-${suffix}`;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

export function messageText(message: AgentMessage, labelImages = false): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const block = part as { type?: string; text?: string; mimeType?: string };
    if (block.type === "text") return [block.text ?? ""];
    if (block.type === "image") return [labelImages ? `[图片 ${block.mimeType ?? "unknown"}]` : ""];
    return [];
  });
  return labelImages ? parts.filter((part) => part.length > 0).join("\n") : parts.join("");
}
