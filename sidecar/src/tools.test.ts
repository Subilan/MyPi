import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkdirTools } from "./tools.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mypi-tools-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readTool(maxReadBytes?: number) {
  const tools = createWorkdirTools((relative) => path.resolve(dir, relative), {
    supportsImages: false,
    maxReadBytes,
  });
  const tool = tools.find((entry) => entry.name === "Read");
  if (!tool) throw new Error("Read tool is missing");
  return tool;
}

describe("Read tool", () => {
  it("reads a small text file", async () => {
    writeFileSync(path.join(dir, "a.txt"), "hello");
    const result = await readTool().execute("call", { path: "a.txt" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text", text: "hello" });
  });

  it("refuses a file above the read cap before loading it", async () => {
    writeFileSync(path.join(dir, "big.txt"), "x".repeat(64));
    const result = await readTool(16).execute("call", { path: "big.txt" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("上限");
  });
});
