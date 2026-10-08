import type { AgentThemeFileData } from "@shared/protocol";

const STYLE_ID = "mypi-theme";

export function applyThemeCss(css: string): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
  }
  style.textContent = css;
  document.head.appendChild(style);
}

export function formatThemeFile(data: AgentThemeFileData): string {
  return `${data.path}\n\n${data.text.trim() || "（空）"}`;
}

export function formatPresets(data: AgentThemeFileData): string {
  const lines = data.presets.map(
    (preset) => `${preset.name}  ${preset.label}  ${preset.description}`,
  );
  return ["可用的预设：", ...lines, "", "用法：/ui apply <name|default>"].join("\n");
}
