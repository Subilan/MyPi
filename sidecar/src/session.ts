import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import dayjs from "dayjs";
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
  const override = process.env.MYPI_SESSIONS?.trim();
  if (override) return override;
  return path.join(path.dirname(resolveSettingsPath()), "sessions");
}

interface SessionHeader {
  kind: "session";
  id: string;
  parent?: string | null;
  at: number;
  mode: ChatMode;
  workdir: string;
  provider: string;
  model: string;
}

interface NodeFields {
  id?: string;
  parent?: string | null;
}

type StoredRecord =
  | SessionHeader
  | ({ kind: "user"; at: number; message: AgentMessage } & NodeFields)
  | ({ kind: "assistant"; at: number; message: AgentMessage } & NodeFields)
  | ({ kind: "tool"; at: number; message: AgentMessage; durationMs?: number } & NodeFields)
  | ({ kind: "error"; at: number; text: string } & NodeFields)
  | ({ kind: "mode"; at: number; mode: ChatMode } & NodeFields)
  | ({ kind: "workdir"; at: number; path: string } & NodeFields);

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
  #warned = false;
  #nextIndex = 0;
  #head: string | null = null;
  #toolStartedAt = new Map<string, number>();
  #toolDurations = new Map<string, number>();

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
    this.#nextIndex = 0;
    this.#head = null;
    this.#toolStartedAt.clear();
    this.#toolDurations.clear();
  }

  resume(id: string): void {
    const exists = existsSync(this.file(id));
    if (!exists) {
      if (id === this.#id) return;
      throw new Error(`找不到会话 ${id}`);
    }
    const records = withIds(this.#read(this.file(id)));
    this.#id = id;
    this.#meta = null;
    this.#started = true;
    this.#nextIndex = nextLineIndex(records);
    this.#head = lastNodeId(records);
    this.#toolStartedAt.clear();
    this.#toolDurations.clear();
  }

  setHead(id: string | null): void {
    if (id === null) {
      this.#head = null;
      return;
    }
    const records = withIds(this.#read(this.file()));
    if (!records.some((record) => record.kind !== "session" && record.id === id)) {
      throw new Error(`找不到消息 ${id}`);
    }
    this.#head = id;
  }

  user(text: string): void {
    if (!text) return;
    const at = dayjs().valueOf();
    this.#append({
      kind: "user",
      at,
      message: { role: "user", content: [{ type: "text", text }], timestamp: at },
    });
  }

  event(event: AgentEvent): void {
    switch (event.type) {
      case "message_end": {
        if (event.message.role !== "assistant") return;
        const message = event.message;
        const content = message.content.filter((part) => part.type !== "thinking");
        if (content.length === 0 && !message.errorMessage) return;
        this.#append({
          kind: "assistant",
          at: message.timestamp,
          message: { ...message, content },
        });
        return;
      }
      case "tool_execution_start": {
        this.#toolStartedAt.set(event.toolCallId, dayjs().valueOf());
        return;
      }
      case "tool_execution_end": {
        const startedAt = this.#toolStartedAt.get(event.toolCallId);
        this.#toolStartedAt.delete(event.toolCallId);
        if (startedAt !== undefined) {
          this.#toolDurations.set(event.toolCallId, Math.max(0, dayjs().valueOf() - startedAt));
        }
        return;
      }
      case "turn_end": {
        for (const result of event.toolResults) {
          const durationMs = this.#toolDurations.get(result.toolCallId);
          this.#toolDurations.delete(result.toolCallId);
          this.#append({ kind: "tool", at: result.timestamp, message: result, durationMs });
        }
        return;
      }
      default:
        return;
    }
  }

  error(text: string): void {
    if (!text) return;
    this.#append({ kind: "error", at: dayjs().valueOf(), text });
  }

  mode(mode: ChatMode): void {
    this.#append({ kind: "mode", at: dayjs().valueOf(), mode });
  }

  workdir(target: string): void {
    this.#append({ kind: "workdir", at: dayjs().valueOf(), path: target });
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

  read(id: string = this.#id): SessionData {
    if (!ID_PATTERN.test(id)) throw new Error(`非法的会话 id：${id}`);
    const file = this.file(id);
    if (!existsSync(file)) {
      if (id === this.#id) {
        return { summary: this.#currentSummary(), nodes: [], head: null, history: [] };
      }
      throw new Error(`找不到会话 ${id}`);
    }
    const records = withIds(this.#read(file));
    const nodes: AgentSessionEntry[] = [];
    const messages = new Map<string, AgentMessage>();
    const parents = new Map<string, string | null>();
    const argsByCall = new Map<string, unknown>();
    for (const record of records) {
      if (record.kind === "session") continue;
      const entry = toEntry(record, argsByCall);
      if (!entry) continue;
      nodes.push(entry);
      parents.set(entry.id, entry.parent);
      if ("message" in record) messages.set(entry.id, record.message);
    }
    const head = id === this.#id ? this.#head : lastNodeId(records);
    return {
      summary: this.#summarize(id, records),
      nodes,
      head,
      history: collectHistory(head, messages, parents),
    };
  }

  search(query: string): string[] {
    const keyword = query.trim().toLowerCase();
    const ids = this.#files().slice(0, MAX_LIST);
    if (!keyword) return ids;
    return ids.filter((id) => this.#matches(id, keyword));
  }

  #matches(id: string, keyword: string): boolean {
    if (id.toLowerCase().includes(keyword)) return true;
    let records: StoredRecord[];
    try {
      records = this.#read(this.file(id));
    } catch {
      return false;
    }
    return records.some(
      (record) =>
        (record.kind === "user" || record.kind === "assistant") &&
        messageText(record.message).toLowerCase().includes(keyword),
    );
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

  #read(file: string): StoredRecord[] {
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
    const parsed = records ?? withIds(this.#read(file));
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
      startedAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
      mode: this.#meta?.mode ?? "regular",
      workdir: this.#meta?.workdir ?? homedir(),
      userMessages: 0,
      assistantMessages: 0,
      preview: "",
      path: file,
      current: true,
    };
  }

  #append(record: StoredRecord): void {
    if (!this.#started) {
      const meta = this.#meta;
      if (meta) this.#emitLine({ kind: "session", id: this.#id, at: dayjs().valueOf(), ...meta });
      this.#started = true;
    }
    const id = `line${this.#nextIndex}`;
    const next = { ...record, id, parent: this.#head } as StoredRecord;
    if (!this.#emitLine(next)) return;
    this.#head = id;
  }

  #emitLine(record: StoredRecord): boolean {
    try {
      mkdirSync(this.#dir, { recursive: true });
      appendFileSync(this.file(), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      this.#nextIndex += 1;
      return true;
    } catch (error) {
      if (this.#warned) return false;
      this.#warned = true;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[sidecar] warn: 会话记录写入失败（${message}），本次运行不再重试\n`);
      return false;
    }
  }
}

function withIds(records: StoredRecord[]): StoredRecord[] {
  const out: StoredRecord[] = [];
  let previous: string | null = null;
  records.forEach((record, index) => {
    const fallback = `line${index}`;
    const id =
      record.kind === "session"
        ? fallback
        : typeof record.id === "string"
          ? record.id
          : fallback;
    let parent: string | null;
    if (Object.prototype.hasOwnProperty.call(record, "parent")) {
      parent = record.parent ?? null;
    } else {
      parent = record.kind === "session" ? null : previous;
    }
    out.push({ ...record, id, parent });
    if (record.kind !== "session") previous = id;
  });
  return out;
}

function lastNodeId(records: StoredRecord[]): string | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.kind !== "session") return record.id ?? null;
  }
  return null;
}

function nextLineIndex(records: StoredRecord[]): number {
  let max = -1;
  for (const record of records) {
    const match = /^line(\d+)$/.exec(record.id ?? "");
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max + 1;
}

function toEntry(
  record: StoredRecord,
  argsByCall: Map<string, unknown>,
): AgentSessionEntry | null {
  const id = record.id ?? "";
  const parent = record.parent ?? null;
  switch (record.kind) {
    case "user": {
      if (record.message.role !== "user") return null;
      return { id, parent, role: "user", at: record.at, text: messageText(record.message) };
    }
    case "assistant": {
      const message = record.message;
      if (message.role !== "assistant") return null;
      for (const part of message.content) {
        if (part.type === "toolCall") argsByCall.set(part.id, part.arguments);
      }
      return {
        id,
        parent,
        role: "assistant",
        at: record.at,
        text: messageText(message),
        stopReason: message.stopReason,
        error: message.errorMessage ?? null,
      };
    }
    case "tool": {
      const message = record.message;
      if (message.role !== "toolResult") return null;
      return {
        id,
        parent,
        role: "tool",
        at: record.at,
        toolCallId: message.toolCallId,
        name: message.toolName,
        args: argsByCall.get(message.toolCallId),
        isError: message.isError,
        output: messageText(message, true),
        durationMs: record.durationMs,
      };
    }
    case "error":
      return { id, parent, role: "error", at: record.at, text: record.text };
    case "mode":
      return { id, parent, role: "notice", at: record.at, title: "MODE", text: record.mode };
    case "workdir":
      return { id, parent, role: "notice", at: record.at, title: "CWD", text: record.path };
    default:
      return null;
  }
}

function collectHistory(
  head: string | null,
  messages: Map<string, AgentMessage>,
  parents: Map<string, string | null>,
): AgentMessage[] {
  const chain: AgentMessage[] = [];
  const seen = new Set<string>();
  let cursor = head;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const message = messages.get(cursor);
    if (message) chain.push(message);
    cursor = parents.get(cursor) ?? null;
  }
  return chain.reverse();
}

function newSessionId(now = dayjs()): string {
  const stamp = now.format("YYYYMMDD-HHmmss");
  const suffix = Math.floor(Math.random() * 0x10000000)
    .toString(16)
    .padStart(7, "0");
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
