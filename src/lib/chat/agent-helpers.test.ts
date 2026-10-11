import { describe, expect, it } from "vitest";
import { errorFor, infoText, resolveSession } from "./agent-helpers";
import type { AgentRuntimeInfo, AgentSessionSummary } from "@shared/protocol";

function session(id: string, startedAt = 0): AgentSessionSummary {
  return {
    id,
    startedAt,
    updatedAt: startedAt,
    mode: "regular",
    workdir: "/tmp",
    userMessages: 1,
    assistantMessages: 1,
    preview: "hi",
    path: `/tmp/${id}.jsonl`,
    current: false,
  };
}

const runtime: AgentRuntimeInfo = {
  protocol: 1,
  runtime: "node v22",
  platform: "darwin arm64",
  coreVersion: "core 1.0",
  provider: "deepseek",
  model: "deepseek-flash",
  thinkingLevel: "high",
  settingsPath: "/tmp/settings.toml",
  workdir: "/tmp",
  mode: "deliver",
  sessionId: "20260101-000000-aaaaaaa",
  sessionsDir: "/tmp/sessions",
  configError: null,
};

describe("resolveSession", () => {
  const sessions = [session("20260101-000000-aaaaaaa"), session("20260102-000000-bbbbbbb")];

  it("resolves a 1-based index", () => {
    expect(resolveSession(sessions, "2")?.id).toBe("20260102-000000-bbbbbbb");
    expect(resolveSession(sessions, "9")).toBeNull();
  });

  it("resolves an exact id or a unique prefix", () => {
    const named = [session("alpha-1"), session("beta-2"), session("beta-3")];
    expect(resolveSession(sessions, "20260101-000000-aaaaaaa")?.id).toBe(sessions[0].id);
    expect(resolveSession(named, "alpha")?.id).toBe("alpha-1");
  });

  it("returns null for an ambiguous or unknown prefix", () => {
    const sessions = [session("20260101-000000-aaaaaaa"), session("20260102-000000-bbbbbbb")];
    expect(resolveSession(sessions, "2026")).toBeNull();
    expect(resolveSession(sessions, "nope")).toBeNull();
  });
});

describe("infoText", () => {
  it("reports the disconnected state", () => {
    expect(infoText(null, "regular", false)).toBe("尚未连接到 sidecar。");
  });

  it("includes the model, mode and run state", () => {
    const text = infoText(runtime, "deliver", true);
    expect(text).toContain("deepseek/deepseek-flash");
    expect(text).toContain("Deliver");
    expect(text).toContain("running");
  });
});

describe("errorFor", () => {
  it("only reports a failure for an error stop reason", () => {
    expect(errorFor({ role: "assistant", stopReason: "error" })).toBe("模型调用失败");
    expect(errorFor({ role: "assistant", stopReason: "error", errorMessage: "boom" })).toBe("boom");
    expect(errorFor({ role: "assistant", stopReason: "aborted" })).toBeNull();
    expect(errorFor({ role: "assistant", stopReason: "end" })).toBeNull();
  });
});
