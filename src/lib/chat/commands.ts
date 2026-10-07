import type { ChatMode } from "@shared/protocol";

export type CommandAction =
  | { type: "clear" }
  | { type: "system.show" }
  | { type: "system.edit" }
  | { type: "cwd.show" }
  | { type: "cwd.set"; path: string }
  | { type: "info.show" }
  | { type: "mode.show" }
  | { type: "mode.set"; mode: ChatMode }
  | { type: "sessions.list" }
  | { type: "sessions.switch"; target: string }
  | { type: "jump" }
  | { type: "ui.show" }
  | { type: "ui.list" }
  | { type: "ui.apply"; name: string }
  | { type: "ui.edit" }
  | { type: "ui.usage" };

export interface AgentCommand {
  name: string;
  aliases: readonly string[];
  description: string;
  usage: string;
}

interface CommandSpec extends AgentCommand {
  parse(args: string[], raw: string): CommandAction | null;
}

const SYSTEM_SUBCOMMANDS: readonly { name: string; action: CommandAction }[] = [
  { name: "edit", action: { type: "system.edit" } },
];

function parseSystem(args: string[], _raw: string): CommandAction | null {
  if (args.length === 0) return { type: "system.show" };
  if (args.length > 1) return null;
  const name = matchSubcommand(args[0].toLowerCase());
  return SYSTEM_SUBCOMMANDS.find((entry) => entry.name === name)?.action ?? null;
}

function matchSubcommand(value: string): string | null {
  const matches = SYSTEM_SUBCOMMANDS.filter((entry) => entry.name.startsWith(value));
  return matches.length === 1 ? matches[0].name : null;
}

const CHAT_MODES: readonly ChatMode[] = ["regular", "deliver"];

export function modeLabel(mode: ChatMode): string {
  return mode === "deliver" ? "Deliver" : "Regular";
}

function parseMode(args: string[]): CommandAction | null {
  if (args.length === 0) return { type: "mode.show" };
  if (args.length > 1) return null;
  const value = args[0].toLowerCase();
  const matches = CHAT_MODES.filter((mode) => mode.startsWith(value));
  return matches.length === 1 ? { type: "mode.set", mode: matches[0] } : null;
}

const UI_SUBCOMMANDS = ["list", "apply", "edit"] as const;

function parseUi(args: string[]): CommandAction | null {
  if (args.length === 0) return { type: "ui.show" };
  const name = matchUiSubcommand(args[0].toLowerCase());
  if (name === "list" && args.length === 1) return { type: "ui.list" };
  if (name === "apply" && args.length === 2) return { type: "ui.apply", name: args[1] };
  if (name === "edit" && args.length === 1) return { type: "ui.edit" };
  return { type: "ui.usage" };
}

function matchUiSubcommand(value: string): (typeof UI_SUBCOMMANDS)[number] | null {
  const matches = UI_SUBCOMMANDS.filter((name) => name.startsWith(value));
  return matches.length === 1 ? matches[0] : null;
}

const SPECS: readonly CommandSpec[] = [
  {
    name: "clear",
    aliases: ["new"],
    description: "清空上下文和聊天记录",
    usage: "/clear",
    parse: (args) => (args.length === 0 ? { type: "clear" } : null),
  },
  {
    name: "system",
    aliases: [],
    description: "查看或编辑系统提示词",
    usage: "/system [edit]",
    parse: parseSystem,
  },
  {
    name: "cd",
    aliases: [],
    description: "查看或切换 agent 的工作目录",
    usage: "/cd [path]",
    parse: (args, raw) =>
      args.length === 0 ? { type: "cwd.show" } : { type: "cwd.set", path: unquote(raw) },
  },
  {
    name: "info",
    aliases: ["status"],
    description: "查看模型、模式、工作目录等运行信息",
    usage: "/info",
    parse: (args) => (args.length === 0 ? { type: "info.show" } : null),
  },
  {
    name: "mode",
    aliases: [],
    description: "查看或切换 regular / deliver 模式",
    usage: "/mode [regular|deliver]",
    parse: parseMode,
  },
  {
    name: "sessions",
    aliases: ["session"],
    description: "打开会话列表页，或用序号 / id 直接切换到一个历史会话",
    usage: "/sessions [序号|id]",
    parse: (args) => {
      if (args.length === 0) return { type: "sessions.list" };
      if (args.length === 1) return { type: "sessions.switch", target: args[0] };
      return null;
    },
  },
  {
    name: "jump",
    aliases: [],
    description: "进入跳转视图，在当前会话的消息树里回溯或切换分支",
    usage: "/jump",
    parse: (args) => (args.length === 0 ? { type: "jump" } : null),
  },
  {
    name: "ui",
    aliases: [],
    description: "查看或编辑界面主题，列出、应用预设",
    usage: "/ui [list|edit|apply <name>]",
    parse: parseUi,
  },
];

const INDEX = new Map<string, CommandSpec>();
for (const spec of SPECS) {
  INDEX.set(spec.name, spec);
  for (const alias of spec.aliases) INDEX.set(alias, spec);
}

export const COMMANDS: readonly AgentCommand[] = SPECS;

export function parseCommand(input: string): CommandAction | null {
  const trimmed = input.trim();
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  const spec = INDEX.get(match[1].toLowerCase());
  if (!spec) return null;
  const raw = (match[2] ?? "").trim();
  return spec.parse(raw ? raw.split(/\s+/) : [], raw);
}

function unquote(value: string): string {
  const match = /^"([\s\S]*)"$/.exec(value.trim());
  return match ? match[1] : value.trim();
}
