import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveSettingsPath } from "./settings.ts";

export interface PromptFile {
  path: string;
  text: string;
}

export function resolvePromptPath(): string {
  const override = process.env.AGENT_RUNBOOK_SYSTEM_PROMPT?.trim();
  if (override) return override;
  return path.join(path.dirname(resolveSettingsPath()), "system-prompt.md");
}

export function openPromptFile(seed: string): PromptFile {
  const file = resolvePromptPath();
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${seed}\n`, { mode: 0o600 });
  }
  return { path: file, text: readPromptText(file, seed) };
}

export function readPromptText(file: string, fallback: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

export function writePromptText(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, { mode: 0o600 });
}
