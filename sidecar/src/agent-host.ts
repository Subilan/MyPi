import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels, type Provider } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type { ChatMode, DecisionAnswer } from "../../shared/protocol.ts";
import { createDeliverTools, DecisionRegistry } from "./deliver.ts";
import { openPromptFile, readPromptText, writePromptText } from "./prompt.ts";
import { loadSettings } from "./settings.ts";
import { createWorkdirTools } from "./tools.ts";
import { resolveInitialWorkdir, Workdir } from "./workdir.ts";

interface ProviderAdapter {
  create: () => Provider;
  envKeys: readonly string[];
}

const PROVIDERS: Record<string, ProviderAdapter> = {
  deepseek: { create: deepseekProvider, envKeys: ["DEEPSEEK_API_KEY"] },
};

export interface AgentHost {
  provider: string;
  model: string;
  thinkingLevel: string;
  settingsPath: string;
  configError: string | null;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  clear(): Promise<void>;
  systemPrompt(): { path: string; text: string };
  saveSystemPrompt(text: string): { path: string; text: string };
  workdir(): string;
  setWorkdir(input: string): string;
  mode(): ChatMode;
  setMode(mode: ChatMode): ChatMode;
  answerDecision(toolCallId: string, answers: DecisionAnswer[]): boolean;
  snapshot(): { messageCount: number; isStreaming: boolean };
}

export function createAgentHost(onEvent: (event: AgentEvent) => void): AgentHost {
  const { settings, error } = loadSettings();
  const file = openPromptFile(settings.systemPrompt);
  const workdir = new Workdir(resolveInitialWorkdir());

  const promptFile = (apply?: (text: string) => void) => ({
    systemPrompt: () => ({ path: file.path, text: readPromptText(file.path, file.text) }),
    saveSystemPrompt: (text: string) => {
      writePromptText(file.path, text);
      apply?.(text);
      return { path: file.path, text };
    },
  });

  const info = {
    provider: settings.provider,
    model: settings.model,
    thinkingLevel: settings.thinkingLevel as string,
    settingsPath: settings.path,
  };

  const broken = (configError: string): AgentHost => ({
    ...info,
    configError,
    ...promptFile(),
    async prompt() {
      throw new Error(configError);
    },
    async abort() {},
    async clear() {},
    workdir: () => workdir.path,
    setWorkdir() {
      throw new Error(configError);
    },
    mode: () => "regular",
    setMode() {
      throw new Error(configError);
    },
    answerDecision: () => false,
    snapshot: () => ({ messageCount: 0, isStreaming: false }),
  });

  if (error) return broken(error);

  const adapter = PROVIDERS[settings.provider];
  if (!adapter) {
    return broken(
      `不支持的 provider "${settings.provider}"，可选：${Object.keys(PROVIDERS).join(" / ")}`,
    );
  }

  const apiKey = settings.apiKey || ambientKey(adapter.envKeys);
  if (!apiKey) {
    return broken(
      `没有可用的 API key，请在 ${settings.path} 里填 api_key，或设置 ${adapter.envKeys.join(" / ")}`,
    );
  }

  const models = createModels();
  models.setProvider(adapter.create());
  const model = models.getModel(settings.provider, settings.model);
  if (!model) {
    const available = models
      .getModels(settings.provider)
      .map((entry) => entry.id)
      .join(" / ");
    return broken(
      `${settings.path} 里的 model "${settings.model}" 不在 ${settings.provider} 的模型列表里，可选：${available}`,
    );
  }

  const tools = createWorkdirTools((relative) => workdir.resolve(relative), {
    supportsImages: model.input.includes("image"),
    imageMaxBytes: model.inputLimits?.images?.resize?.maxBytes,
  });
  const decisions = new DecisionRegistry();
  const deliverTools = createDeliverTools(decisions);

  let mode: ChatMode = "regular";
  let forcedContinues = 0;

  const build = (systemPrompt: string, history?: AgentMessage[]): Agent => {
    const agent = new Agent({
      initialState: {
        systemPrompt: composeSystemPrompt(systemPrompt, workdir.path, mode),
        model,
        thinkingLevel: settings.thinkingLevel,
        tools: mode === "deliver" ? [...tools, ...deliverTools] : tools,
        ...(history && history.length > 0 ? { messages: history } : {}),
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => apiKey,
      finishTurn: (turn) => {
        if (mode !== "deliver") return undefined;
        const reported = turn.toolResults.some(
          (result) => result.toolName === "report_success" || result.toolName === "report_failure",
        );
        if (reported) {
          forcedContinues = 0;
          return { action: "end" };
        }
        if (turn.toolResults.length > 0) {
          forcedContinues = 0;
          return undefined;
        }
        forcedContinues += 1;
        return forcedContinues <= MAX_FORCED_CONTINUES ? { action: "continue" } : undefined;
      },
    });
    agent.subscribe((event) => {
      onEvent(event);
    });
    return agent;
  };

  let promptText = file.text;
  let agent = build(promptText);
  const rebuild = (text: string) => {
    const history = agent.state.messages.filter((message) => message.role !== "system");
    agent = build(text, history);
  };

  return {
    ...info,
    configError: null,
    ...promptFile((text) => {
      promptText = text;
      rebuild(text);
    }),
    workdir: () => workdir.path,
    setWorkdir(input: string) {
      const next = workdir.set(input);
      rebuild(promptText);
      return next;
    },
    mode: () => mode,
    setMode(next: ChatMode) {
      mode = next;
      rebuild(promptText);
      return mode;
    },
    answerDecision(toolCallId: string, answers: DecisionAnswer[]) {
      return decisions.answer(toolCallId, answers);
    },
    async prompt(text: string) {
      forcedContinues = 0;
      await agent.prompt(text);
    },
    async abort() {
      agent.abort();
      await agent.waitForIdle();
    },
    async clear() {
      agent.abort();
      agent.reset();
      await agent.waitForIdle();
    },
    snapshot: () => ({
      messageCount: agent.state.messages.length,
      isStreaming: agent.state.isStreaming,
    }),
  };
}

const MAX_FORCED_CONTINUES = 3;

const DELIVER_PROMPT = [
  "## Deliver mode",
  "The user only sees structured deliverables, never your free-form text. Do not reply with prose.",
  "Do the work with the available tools, then end the task by calling exactly one of:",
  "- report_success: the request is fulfilled. Include a concise description (max 50 chars), optional artifact paths (web links or absolute local paths), and optional next steps.",
  "- report_failure: you cannot fulfill the request. Explain the reason (max 50 chars) and optional suggestions.",
  "When the user must make a choice, call request_user_decision with one question or a batch of questions before guessing.",
  "Every tool argument must match its field's semantics; never pass information that does not belong to a field.",
].join("\n");

function composeSystemPrompt(base: string, workdir: string, mode: ChatMode): string {
  const context = [
    `Current working directory: ${workdir}`,
    "Resolve relative paths against it; use the Read / Edit / Write / Bash tools to inspect and change files.",
  ].join("\n");
  const trimmed = base.trim();
  return [trimmed, context, mode === "deliver" ? DELIVER_PROMPT : ""]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function ambientKey(envKeys: readonly string[]): string {
  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}
