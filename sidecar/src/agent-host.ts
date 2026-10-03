import { Agent, type AgentEvent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

const SYSTEM_PROMPT = [
  "You are the agent behind agent-runbook, a desktop app.",
  "Keep answers short and concrete.",
].join(" ");

export interface AgentHost {
  model: string;
  demo: boolean;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  snapshot(): { messageCount: number; isStreaming: boolean };
}

export function createAgentHost(onEvent: (event: AgentEvent) => void): AgentHost {
  // 演示用 provider，不需要任何凭证；接入真实模型时替换这里
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const models = createModels();
  models.setProvider(faux.provider);

  const model = faux.getModel();
  const agent = new Agent({
    initialState: { systemPrompt: SYSTEM_PROMPT, model },
    streamFn: models.streamSimple.bind(models),
  });
  agent.subscribe((event) => onEvent(event));

  return {
    model: `${model.provider}/${model.id}`,
    demo: true,
    snapshot: () => ({
      messageCount: agent.state.messages.length,
      isStreaming: agent.state.isStreaming,
    }),
    async prompt(text: string) {
      faux.setResponses([
        fauxAssistantMessage(
          `hello world from pi-agent-core。你刚说的是：「${text}」。这条回复由 sidecar 里的 Agent 循环流式产生。`,
        ),
      ]);
      await agent.prompt(text);
    },
    abort: async () => {
      agent.abort();
      await agent.waitForIdle();
    },
  };
}
