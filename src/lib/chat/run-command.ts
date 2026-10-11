import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentRuntimeInfo, ChatMode } from "@shared/protocol";
import type { AgentClient } from "@/lib/agent/client";
import { describe } from "@/lib/chat/agent-helpers";
import { modeLabel, type CommandAction } from "@/lib/chat/commands";
import type { ConfirmMessage, NoticeMessage } from "@/lib/chat/types";
import { applyThemeCss, formatPresets, formatThemeFile } from "@/lib/theme";

export interface CommandDeps {
  client: AgentClient;
  appendNotice(notice: Omit<NoticeMessage, "id" | "role" | "createdAt">): void;
  appendError(text: string): void;
  appendConfirm(confirm: Omit<ConfirmMessage, "id" | "role" | "createdAt" | "answer">): void;
  editSystemPrompt(): void;
  editTheme(): void;
  info: string;
  openSessionBrowser(): void;
  switchSession(target: string): Promise<void>;
  openJumpView(): void;
  mode: ChatMode;
  runningRef: RefObject<boolean>;
  requestedModeRef: RefObject<ChatMode | null>;
  setRuntime: Dispatch<SetStateAction<AgentRuntimeInfo | null>>;
  setSessionId(id: string): void;
  clearMessages(): void;
  resetAssistant(): void;
}

export function runCommand(action: CommandAction, deps: CommandDeps): void {
  const failed = (error: unknown) => deps.appendError(describe(error));

  switch (action.type) {
    case "clear":
      deps.client
        .clear()
        .then((data) => {
          deps.resetAssistant();
          deps.setSessionId(data.sessionId);
          deps.setRuntime((current) =>
            current ? { ...current, sessionId: data.sessionId } : current,
          );
          deps.clearMessages();
        })
        .catch(failed);
      return;
    case "system.show":
      deps.client
        .systemPrompt()
        .then((data) => {
          deps.appendNotice({
            title: "SYSTEM PROMPT",
            text: `${data.path}\n\n${data.text}`,
            error: null,
          });
        })
        .catch(failed);
      return;
    case "system.edit":
      deps.editSystemPrompt();
      return;
    case "cwd.show":
      deps.client
        .cwd()
        .then((data) => {
          deps.appendNotice({ title: "CWD", text: data.path, error: null });
        })
        .catch(failed);
      return;
    case "cwd.set":
      deps.client
        .setCwd(action.path)
        .then((data) => {
          deps.setRuntime((current) => (current ? { ...current, workdir: data.path } : current));
          deps.appendNotice({ title: "CWD", text: data.path, error: null });
        })
        .catch(failed);
      return;
    case "info.show":
      deps.appendNotice({ title: "INFO", text: deps.info, error: null });
      return;
    case "sessions.list":
      deps.openSessionBrowser();
      return;
    case "sessions.switch":
      deps.switchSession(action.target).catch(failed);
      return;
    case "jump":
      if (deps.runningRef.current || deps.requestedModeRef.current !== null) {
        deps.appendError("当前有正在运行或待确认的操作，完成后再跳转");
        return;
      }
      deps.openJumpView();
      return;
    case "mode.show":
      deps.appendNotice({
        title: "MODE",
        text: `当前为 ${modeLabel(deps.mode)} 模式`,
        error: null,
      });
      return;
    case "mode.set":
      if (action.mode === deps.mode) {
        deps.appendNotice({
          title: "MODE",
          text: `当前为 ${modeLabel(deps.mode)} 模式`,
          error: null,
        });
        return;
      }
      if (deps.requestedModeRef.current !== null) return;
      deps.requestedModeRef.current = action.mode;
      deps.appendConfirm({
        title: "CONFIRMATION",
        text: `切换模式会重建 Agent，并把不属于 ${modeLabel(action.mode)} 模式的历史工具调用从模型上下文里移除；聊天记录本身保留。\n确认切换到 ${modeLabel(action.mode)} 模式？`,
        switchTo: action.mode,
      });
      return;
    case "ui.show":
      deps.client
        .theme()
        .then((data) => {
          applyThemeCss(data.text);
          deps.appendNotice({ title: "UI", text: formatThemeFile(data), error: null });
        })
        .catch(failed);
      return;
    case "ui.list":
      deps.client
        .theme()
        .then((data) => {
          applyThemeCss(data.text);
          deps.appendNotice({ title: "UI", text: formatPresets(data), error: null });
        })
        .catch(failed);
      return;
    case "ui.apply":
      deps.client
        .applyUiPreset(action.name)
        .then((data) => {
          applyThemeCss(data.text);
          deps.appendNotice({
            title: "UI",
            text: data.applied ? `已应用预设 ${data.applied.label}` : "已应用默认主题",
            error: null,
          });
        })
        .catch(failed);
      return;
    case "ui.edit":
      deps.editTheme();
      return;
    case "ui.usage":
      deps.client
        .theme()
        .then((data) => {
          deps.appendNotice({
            title: "UI",
            text: `用法：/ui 显示当前主题，/ui list 列出预设，/ui apply <name|default> 应用预设，/ui edit 编辑 CSS。\n\n${formatPresets(data)}`,
            error: null,
          });
        })
        .catch(failed);
      return;
    default:
      return;
  }
}
