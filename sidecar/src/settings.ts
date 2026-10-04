import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { parse } from "smol-toml";

export const DEFAULT_SYSTEM_PROMPT = [
  "You are the assistant behind agent-runbook, a desktop app.",
  "Answer in the user's language and keep replies concise.",
].join(" ");

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";

const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const TEMPLATE = `# agent-runbook 配置

provider = "deepseek"
model = "deepseek-flash"

# 留空时回退到环境变量 DEEPSEEK_API_KEY
api_key = ""

[agent]
# off / minimal / low / medium / high / xhigh / max
thinking = "high"
# system_prompt = "自定义系统提示词"
`;

export interface AgentSettings {
  provider: string;
  model: string;
  apiKey: string;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  path: string;
}

export interface SettingsResult {
  settings: AgentSettings;
  error: string | null;
}

export function resolveSettingsPath(): string {
  const override = process.env.AGENT_RUNBOOK_SETTINGS?.trim();
  if (override) return override;
  return path.join(homedir(), ".agent-runbook", "settings.toml");
}

export function loadSettings(): SettingsResult {
  const file = resolveSettingsPath();
  const problems: string[] = [];
  let data: Record<string, unknown> = {};
  let content: string | null = null;

  if (!existsSync(file)) {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, TEMPLATE, { mode: 0o600 });
      problems.push(`已生成默认配置 ${file}`);
      content = TEMPLATE;
    } catch (error) {
      problems.push(`无法创建 ${file}：${message(error)}`);
    }
  } else {
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      problems.push(`无法读取 ${file}：${message(error)}`);
    }
  }

  if (content !== null) {
    try {
      data = parse(content) as Record<string, unknown>;
    } catch (error) {
      problems.push(`${file} 不是合法的 TOML：${message(error)}`);
    }
  }

  const provider = readString(data, "provider");
  const model = readString(data, "model");
  const apiKey = readString(data, "api_key") ?? "";
  const agentSection = isRecord(data.agent) ? data.agent : {};
  const thinking = readString(agentSection, "thinking");
  const systemPrompt = readString(agentSection, "system_prompt");

  if (!provider) problems.push(`${file} 缺少 provider`);
  if (!model) problems.push(`${file} 缺少 model`);

  let thinkingLevel = DEFAULT_THINKING_LEVEL;
  if (thinking) {
    if (THINKING_LEVELS.includes(thinking as ThinkingLevel)) {
      thinkingLevel = thinking as ThinkingLevel;
    } else {
      problems.push(
        `${file} 里的 thinking = "${thinking}" 不可用，可选：${THINKING_LEVELS.join(" / ")}`,
      );
    }
  }

  return {
    settings: {
      provider: provider ?? "",
      model: model ?? "",
      apiKey,
      thinkingLevel,
      systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      path: file,
    },
    error: problems.length > 0 ? problems.join("；") : null,
  };
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
