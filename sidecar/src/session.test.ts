import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mypi-session-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const meta = {
  mode: "regular" as const,
  workdir: "/tmp",
  provider: "deepseek",
  model: "deepseek-flash",
};

function store(): SessionStore {
  const instance = new SessionStore(dir);
  instance.start(meta);
  return instance;
}

function ids(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      const record = JSON.parse(trimmed) as { kind: string; id?: string };
      return record.kind === "session" ? [] : [record.id ?? ""];
    });
}

describe("SessionStore", () => {
  it("numbers the next record after the highest stored id", () => {
    const first = store();
    first.user("a");
    first.error("e1");
    const id = first.id;

    const resumed = new SessionStore(dir);
    resumed.resume(id);
    resumed.user("b");

    expect(ids(resumed.file())).toEqual(["line1", "line2", "line3"]);
  });

  it("does not reuse an id when a line is unreadable", () => {
    const first = store();
    first.user("a");
    first.error("e1");
    first.user("b");
    first.error("e2");
    const file = first.file();
    const id = first.id;

    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    lines.splice(2, 1);
    writeFileSync(file, `${lines.join("\n")}\n`);

    const resumed = new SessionStore(dir);
    resumed.resume(id);
    resumed.user("c");

    const all = ids(resumed.file());
    expect(new Set(all).size).toBe(all.length);
    expect(all.at(-1)).toBe("line5");
  });
});
