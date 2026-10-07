import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentThemeFileData } from "../../shared/protocol.ts";
import { findPreset, presetSummaries, UI_PRESETS } from "./presets.ts";

export const THEME_TEMPLATE = `/* agent-runbook 主题
 *
 * 在这里写 CSS 即可，文件在内置样式之后注入，所以同名样式以这里为准。
 *
 * 可定制的元素：
 *   .ar-background                          窗口背景
 *   .ar-message-user                        用户消息
 *   .ar-message-assistant                   助手消息
 *   .ar-message-tool                        工具消息，配 [data-status="running|ok|error"]
 *   .ar-message-system                      系统消息，配 [data-tone="info|success|warning|critical|neutral"]
 *   .ar-composer                            输入框外壳
 *   .ar-composer-input                      输入框本体
 *
 * 可覆盖的全局变量：
 *   --ar-font-general  --ar-font-mono
 *   --ar-foreground  --ar-muted  --ar-muted-foreground
 *   --ar-border  --ar-input
 *   --ar-primary  --ar-primary-foreground  --ar-ring  --ar-destructive
 *
 * 例：
 *   :root { --ar-primary: #d97757; }
 *   .ar-background { background-color: #faf9f5; }
 *   .ar-message-user { background-color: #f0eee6; }
 */
`;

export function resolveThemePath(): string {
  const override = process.env.AGENT_RUNBOOK_THEME?.trim();
  if (override) return override;
  return path.join(homedir(), ".agent-runbook", "theme.css");
}

export class ThemeFile {
  readonly path: string;

  constructor() {
    this.path = resolveThemePath();
    this.ensure();
  }

  ensure(): void {
    if (existsSync(this.path)) return;
    mkdirSync(path.dirname(this.path), { recursive: true });
    writeFileSync(this.path, THEME_TEMPLATE, { mode: 0o600 });
  }

  data(): AgentThemeFileData {
    return { path: this.path, text: this.read(), presets: presetSummaries(), applied: null };
  }

  read(): string {
    try {
      return readFileSync(this.path, "utf8");
    } catch {
      return "";
    }
  }

  save(text: string): AgentThemeFileData {
    writeFileSync(this.path, text, { mode: 0o600 });
    return this.data();
  }

  applyPreset(rawName: string): AgentThemeFileData {
    const value = rawName.trim();
    if (!value || value.toLowerCase() === "default" || value.toLowerCase() === "none") {
      return this.save(THEME_TEMPLATE);
    }
    const preset = findPreset(value);
    if (!preset) {
      throw new Error(`未知的预设 "${value}"，可用：${UI_PRESETS.map((entry) => entry.name).join(" / ")}`);
    }
    const data = this.save(preset.css);
    return {
      ...data,
      applied: { name: preset.name, label: preset.label, description: preset.description },
    };
  }
}
