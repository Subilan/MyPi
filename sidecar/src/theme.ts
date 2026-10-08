import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentThemeFileData } from "../../shared/protocol.ts";
import { findPreset, presetSummaries, UI_PRESETS } from "./presets.ts";

export const THEME_TEMPLATE = `/* MyPi 主题
 *
 * 在这里写 CSS 即可，文件在内置样式之后注入，所以同名样式以这里为准。
 *
 * 可定制的元素：
 *   .mypi-background          窗口背景
 *   .mypi-message-user        用户消息
 *   .mypi-message-assistant   助手消息
 *   .mypi-message-tool        工具消息，配 [data-status="running|ok|error"]
 *   .mypi-message-system      系统消息，配 [data-tone="info|success|warning|critical|neutral"]
 *   .mypi-composer            输入框外壳
 *   .mypi-composer-input      输入框本体
 *
 * 可覆盖的全局变量：
 *   --mypi-font-general  --mypi-font-mono
 *   --mypi-foreground  --mypi-muted  --mypi-muted-foreground
 *   --mypi-border  --mypi-input
 *   --mypi-primary  --mypi-primary-foreground  --mypi-ring  --mypi-destructive
 *
 * 例：
 *   :root { --mypi-primary: #d97757; }
 *   .mypi-background { background-color: #faf9f5; }
 *   .mypi-message-user { background-color: #f0eee6; }
 */
`;

export function resolveThemePath(): string {
  const override = process.env.MYPI_THEME?.trim();
  if (override) return override;
  return path.join(homedir(), ".mypi", "theme.css");
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
