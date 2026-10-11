import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

import { AgentClient } from "./client";

describe("AgentClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a request when the sidecar never answers", async () => {
    vi.useFakeTimers();
    const client = new AgentClient();
    const assertion = expect(client.hello("world")).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});
