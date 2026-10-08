import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function resolveInitialWorkdir(): string {
  const override = process.env.MYPI_WORKDIR?.trim();
  if (!override) return homedir();
  const candidate = normalizeDir(override, homedir());
  if (isDirectory(candidate)) return candidate;
  process.stderr.write(`[sidecar] warn: MYPI_WORKDIR 不是可用目录，改用 ${homedir()}\n`);
  return homedir();
}

export function normalizeDir(input: string, base: string): string {
  const expanded = expandHome(input.trim());
  if (!expanded) return path.resolve(base);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(base, expanded);
}

export function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

export class Workdir {
  #current: string;

  constructor(initial: string) {
    this.#current = normalDir(initial) ?? homedir();
  }

  get path(): string {
    return this.#current;
  }

  set(input: string): string {
    const next = normalizeDir(input, this.#current);
    if (!isDirectory(next)) throw new Error(`不是可用的目录：${next}`);
    this.#current = next;
    return next;
  }

  resolve(relative: string): string {
    return normalizeDir(relative, this.#current);
  }
}

function normalDir(target: string): string | null {
  return isDirectory(target) ? path.resolve(target) : null;
}
