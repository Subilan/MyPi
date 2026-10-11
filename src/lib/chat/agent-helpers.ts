import type {
  AgentMessageEndData,
  AgentRuntimeInfo,
  AgentSessionSummary,
  ChatMode,
} from "@shared/protocol";
import { modeLabel } from "@/lib/chat/commands";

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorFor(end: AgentMessageEndData): string | null {
  return end.stopReason === "error" ? (end.errorMessage ?? "模型调用失败") : null;
}

export function infoText(
  runtime: AgentRuntimeInfo | null,
  mode: ChatMode,
  running: boolean,
): string {
  if (!runtime) return "尚未连接到 sidecar。";
  return [
    `模型：${runtime.provider}/${runtime.model}`,
    `模式：${modeLabel(mode)}`,
    `状态：${running ? "running" : "idle"}`,
    `思考级别：${runtime.thinkingLevel}`,
    `工作目录：${runtime.workdir}`,
    `会话：${runtime.sessionId}`,
    `会话目录：${runtime.sessionsDir}`,
    `运行时：${runtime.runtime} · ${runtime.platform}`,
    `核心：${runtime.coreVersion}`,
    `设置：${runtime.settingsPath}`,
  ].join("\n");
}

export function resolveSession(
  sessions: AgentSessionSummary[],
  target: string,
): AgentSessionSummary | null {
  const trimmed = target.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number.parseInt(trimmed, 10) - 1;
    return sessions[index] ?? null;
  }
  const exact = sessions.find((session) => session.id === trimmed);
  if (exact) return exact;
  const prefix = sessions.filter((session) => session.id.startsWith(trimmed));
  return prefix.length === 1 ? prefix[0] : null;
}
