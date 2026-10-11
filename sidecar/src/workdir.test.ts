import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDirectory, normalizeDir } from "./workdir.ts";

describe("normalizeDir", () => {
  it("resolves relative paths against the base", () => {
    expect(normalizeDir("sub/dir", "/base/root")).toBe(path.resolve("/base/root/sub/dir"));
  });

  it("keeps absolute paths and normalizes them", () => {
    expect(normalizeDir("/tmp/../tmp/x", "/base")).toBe(path.resolve("/tmp/x"));
  });

  it("falls back to the base for blank input", () => {
    expect(normalizeDir("   ", "/base/root")).toBe(path.resolve("/base/root"));
  });

  it("expands a bare tilde to the home directory", () => {
    expect(normalizeDir("~", "/base")).toBe(path.resolve(os.homedir()));
  });
});

describe("isDirectory", () => {
  it("accepts an existing directory and rejects a missing one", () => {
    expect(isDirectory(os.homedir())).toBe(true);
    expect(isDirectory(path.join(os.homedir(), "__mypi_missing__"))).toBe(false);
  });
});
