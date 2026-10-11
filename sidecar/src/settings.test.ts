import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSettings } from "./settings.ts";

let dir: string;
const previous = process.env.MYPI_SETTINGS;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mypi-settings-"));
  process.env.MYPI_SETTINGS = path.join(dir, "settings.toml");
});

afterEach(() => {
  if (previous === undefined) delete process.env.MYPI_SETTINGS;
  else process.env.MYPI_SETTINGS = previous;
  rmSync(dir, { recursive: true, force: true });
});

function write(text: string): void {
  writeFileSync(process.env.MYPI_SETTINGS ?? "", text);
}

describe("loadSettings", () => {
  it("creates a default config and reports it as a warning, not a fatal error", () => {
    const result = loadSettings();
    expect(result.error).toBeNull();
    expect(result.warnings.join()).toContain("已生成默认配置");
    expect(existsSync(process.env.MYPI_SETTINGS ?? "")).toBe(true);
  });

  it("downgrades an unknown thinking level to a warning and keeps the fallback", () => {
    write('provider = "deepseek"\nmodel = "deepseek-flash"\n[agent]\nthinking = "turbo"\n');
    const result = loadSettings();
    expect(result.error).toBeNull();
    expect(result.warnings.join()).toContain("turbo");
    expect(result.settings.thinkingLevel).toBe("high");
  });

  it("treats a missing provider or model as fatal", () => {
    write('[agent]\nthinking = "high"\n');
    const result = loadSettings();
    expect(result.error).not.toBeNull();
    expect(result.error).toContain("provider");
    expect(result.error).toContain("model");
  });

  it("treats invalid TOML as fatal", () => {
    write("provider = [oops\n");
    const result = loadSettings();
    expect(result.error).not.toBeNull();
    expect(result.error).toContain("TOML");
  });
});
