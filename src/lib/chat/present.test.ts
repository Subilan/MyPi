import { describe, expect, it } from "vitest";
import { isHidden, previewText, toolDetail } from "./present";
import type { AssistantMessage, ToolMessage } from "@/lib/chat/types";

function tool(name: string, args: unknown): ToolMessage {
  return {
    id: "t1",
    role: "tool",
    toolCallId: "c1",
    name,
    args,
    status: "running",
    output: "",
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
    error: null,
  };
}

const assistant: AssistantMessage = {
  id: "a1",
  role: "assistant",
  text: "hi",
  createdAt: 0,
  startedAt: 0,
  streaming: false,
  thinking: false,
  error: null,
};

describe("previewText", () => {
  it("summarizes decision questions instead of dumping the JSON args", () => {
    const message = tool("request_user_decision", {
      questions: [
        { id: "a", type: "single", question: "用哪个方案？" },
        { id: "b", type: "yes_no", question: "继续吗？" },
      ],
    });
    expect(previewText(message)).toBe("用哪个方案？ / 继续吗？");
  });

  it("falls back to the raw args when the questions are malformed", () => {
    expect(previewText(tool("request_user_decision", { questions: "oops" }))).toContain(
      "request_user_decision",
    );
  });

  it("uses the deliver field for success and failure", () => {
    expect(previewText(tool("report_success", { description: "done" }))).toBe("done");
    expect(previewText(tool("report_failure", { reason: "nope" }))).toBe("nope");
  });
});

describe("toolDetail", () => {
  it("formats read ranges", () => {
    expect(toolDetail(tool("Read", { path: "a.ts", offset: 3, limit: 5 }))).toBe("a.ts:3-7");
    expect(toolDetail(tool("Read", { path: "a.ts", offset: 3 }))).toBe("a.ts:3+");
  });

  it("returns the bash command and the edit path", () => {
    expect(toolDetail(tool("Bash", { command: "ls -la" }))).toBe("ls -la");
    expect(toolDetail(tool("Edit", { path: "b.ts" }))).toBe("b.ts");
  });
});

describe("isHidden", () => {
  it("hides assistant text and non-deliver tools in deliver mode", () => {
    expect(isHidden(tool("Bash", {}), "deliver")).toBe(true);
    expect(isHidden(tool("report_success", {}), "deliver")).toBe(false);
    expect(isHidden(assistant, "deliver")).toBe(true);
    expect(isHidden(tool("Bash", {}), "regular")).toBe(false);
  });
});
