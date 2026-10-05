import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

const MAX_READ_CHARS = 200_000;
const MAX_OUTPUT_CHARS = 100_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;

const readParameters = Type.Object({
  path: Type.String({ description: "文件路径，相对路径按工作目录解析" }),
  offset: Type.Optional(Type.Number({ description: "起始行号，从 1 开始" })),
  limit: Type.Optional(Type.Number({ description: "最多读取的行数" })),
});

const editParameters = Type.Object({
  path: Type.String({ description: "文件路径，相对路径按工作目录解析" }),
  oldText: Type.String({ description: "要被替换的原文，必须与文件中完全一致且在文件中唯一" }),
  newText: Type.String({ description: "替换后的新文本，留空表示删除" }),
});

const writeParameters = Type.Object({
  path: Type.String({ description: "文件路径，相对路径按工作目录解析" }),
  content: Type.String({ description: "写入文件的完整内容，会覆盖已有文件" }),
});

const bashParameters = Type.Object({
  command: Type.String({ description: "要执行的 shell 命令" }),
  timeout: Type.Optional(
    Type.Number({ description: `超时时间（毫秒），默认 ${DEFAULT_TIMEOUT_MS}` }),
  ),
});

export interface WorkdirToolOptions {
  supportsImages: boolean;
  imageMaxBytes?: number;
}

export function createWorkdirTools(
  resolve: (relative: string) => string,
  options: WorkdirToolOptions,
): AgentTool<any>[] {
  return [
    readTool(resolve, options),
    editTool(resolve),
    writeTool(resolve),
    bashTool(resolve),
  ];
}

function readTool(
  resolve: (relative: string) => string,
  options: WorkdirToolOptions,
): AgentTool<typeof readParameters> {
  return {
    name: "Read",
    label: "Read",
    description:
      "读取工作目录下的文件。文本文件可以指定起始行与行数；图片（png/jpeg/gif/webp/bmp）会作为图像返回。",
    parameters: readParameters,
    async execute(_id, params) {
      const target = resolve(params.path);
      let stat;
      try {
        stat = statSync(target);
      } catch {
        return fail(`文件不存在：${target}`);
      }
      if (!stat.isFile()) return fail(`不是文件：${target}`);

      let buffer: Buffer;
      try {
        buffer = readFileSync(target);
      } catch (error) {
        return fail(`读取失败：${message(error)}`);
      }

      const mimeType = imageMimeType(buffer);
      if (mimeType) {
        if (!options.supportsImages) {
          return fail(`${target} 是图片（${mimeType}），但当前模型不支持图片输入，请用 OCR 或先转成文本`);
        }
        const maxBytes = options.imageMaxBytes;
        if (maxBytes && buffer.length > maxBytes) {
          return fail(
            `图片 ${target} 有 ${buffer.length} 字节，超过当前模型 ${maxBytes} 字节的上限，请先压缩或缩放`,
          );
        }
        const note = `已读取图片：${target}（${mimeType}，${buffer.length} 字节）`;
        return {
          content: [
            { type: "image", data: buffer.toString("base64"), mimeType },
            { type: "text", text: note },
          ],
          details: { path: target, mimeType, bytes: buffer.length },
        };
      }

      const content = buffer.toString("utf8");
      if (content.includes("\u0000")) return fail(`看起来是二进制文件，且不是支持的图片格式：${target}`);

      const lines = content.split("\n");
      const offset = Math.max(1, Math.floor(params.offset ?? 1));
      const limit = params.limit && params.limit > 0 ? Math.floor(params.limit) : Infinity;
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      let body = slice.join("\n");
      const notes: string[] = [];

      if (content === "") return reply("(文件为空)");
      if (slice.length === 0) {
        return fail(`起始行 ${offset} 超出范围，文件共 ${lines.length} 行`);
      }

      if (body.length > MAX_READ_CHARS) {
        body = body.slice(0, MAX_READ_CHARS);
        notes.push(`本次读取已截断到 ${MAX_READ_CHARS} 个字符，可用 offset/limit 继续读`);
      }
      const shownEnd = offset - 1 + slice.length;
      if (shownEnd < lines.length) {
        notes.push(`当前显示第 ${offset}-${shownEnd} 行，文件共 ${lines.length} 行`);
      }

      return reply(body + (notes.length > 0 ? `\n\n[${notes.join("；")}]` : ""));
    },
  };
}

function editTool(resolve: (relative: string) => string): AgentTool<typeof editParameters> {
  return {
    name: "Edit",
    label: "Edit",
    description: "把文件中唯一出现的一段原文替换成新文本，用于精确修改文件。",
    parameters: editParameters,
    async execute(_id, params) {
      const target = resolve(params.path);
      let content: string;
      try {
        content = readFileSync(target, "utf8");
      } catch (error) {
        return fail(`无法读取 ${target}：${message(error)}`);
      }
      if (!params.oldText) return fail("oldText 不能为空");

      const matches = countOccurrences(content, params.oldText);
      if (matches === 0) {
        return fail(`在 ${target} 中没有找到 oldText，请确认它与文件内容完全一致`);
      }
      if (matches > 1) {
        return fail(`oldText 在 ${target} 中出现了 ${matches} 次，请补充上下文使其唯一`);
      }

      const index = content.indexOf(params.oldText);
      const next = content.slice(0, index) + params.newText + content.slice(index + params.oldText.length);
      try {
        writeFileSync(target, next, "utf8");
      } catch (error) {
        return fail(`写入失败：${message(error)}`);
      }
      return reply(`已更新 ${target}`);
    },
  };
}

function writeTool(resolve: (relative: string) => string): AgentTool<typeof writeParameters> {
  return {
    name: "Write",
    label: "Write",
    description: "把内容写入文件，文件不存在时创建，已存在时整体覆盖。",
    parameters: writeParameters,
    async execute(_id, params) {
      const target = resolve(params.path);
      try {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, params.content, "utf8");
      } catch (error) {
        return fail(`写入失败：${message(error)}`);
      }
      return reply(`已写入 ${target}（${Buffer.byteLength(params.content, "utf8")} 字节）`);
    },
  };
}

function bashTool(resolve: (relative: string) => string): AgentTool<typeof bashParameters> {
  return {
    name: "Bash",
    label: "Bash",
    description: "在工作目录下执行 shell 命令，返回退出码与标准输出、标准错误。",
    parameters: bashParameters,
    async execute(_id, params, signal) {
      const cwd = resolve(".");
      const timeoutMs = clamp(params.timeout ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
      const result = await runShell(params.command, cwd, timeoutMs, signal);
      const sections = [`exit code: ${result.code ?? "null"}`];
      if (result.stdout.trim()) sections.push(`stdout:\n${clampOutput(result.stdout)}`);
      if (result.stderr.trim()) sections.push(`stderr:\n${clampOutput(result.stderr)}`);
      if (sections.length === 1) sections.push("(无输出)");
      if (result.timedOut) sections.push(`[已超时 ${timeoutMs}ms 并终止进程]`);
      else if (result.aborted) sections.push("[已被中止]");

      const text = sections.join("\n\n");
      return result.timedOut || result.aborted || result.code !== 0 ? fail(text) : reply(text);
    },
  };
}

interface ShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ShellResult> {
  return new Promise((settle) => {
    const { file, args } = shellCommand(command);
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env: process.env,
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      settle({ stdout: "", stderr: message(error), code: null, timedOut: false, aborted: false });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;

    const finish = (code: number | null, error?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) stderr = stderr ? `${stderr}\n${message(error)}` : message(error);
      settle({ stdout, stderr, code, timedOut, aborted: Boolean(signal?.aborted) });
    };

    const kill = () => killTree(child);
    const onAbort = () => kill();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    if (signal?.aborted) kill();
    else signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // 进程组已消失时退回直接杀子进程
    }
  }
  child.kill("SIGKILL");
}

function shellCommand(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { file: process.env.SHELL ?? "/bin/bash", args: ["-lc", command] };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  return null;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  for (;;) {
    const found = haystack.indexOf(needle, index);
    if (found < 0) return count;
    count += 1;
    index = found + needle.length;
  }
}

function clampOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  const half = Math.floor(MAX_OUTPUT_CHARS / 2);
  return `${value.slice(0, half)}\n\n[... 输出过长，已省略中间部分 ...]\n\n${value.slice(-half)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function reply(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: {} };
}

function fail(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: {}, isError: true };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
