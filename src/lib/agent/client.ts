import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentClearData,
  AgentCwdData,
  AgentDecisionData,
  AgentHelloData,
  AgentModeData,
  AgentPromptFileData,
  AgentRecord,
  AgentRequest,
  AgentSessionData,
  AgentSessionListData,
  AgentStateData,
  AgentStatus,
  ChatMode,
  DecisionAnswer,
} from "@shared/protocol";

const RECORD_EVENT = "agent://record";

export interface AppInfo {
  name: string;
  version: string;
  tauri: string;
  os: string;
  arch: string;
}

type PendingResponse = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class AgentClient {
  #pending = new Map<string, PendingResponse>();
  #listeners = new Set<(record: AgentRecord) => void>();
  #connecting?: Promise<void>;
  #unlisten?: UnlistenFn;
  #counter = 0;

  connect(): Promise<void> {
    if (this.#unlisten) return Promise.resolve();
    this.#connecting ??= listen<AgentRecord>(RECORD_EVENT, (event) => {
      this.#dispatch(event.payload);
    }).then((unlisten) => {
      this.#unlisten = unlisten;
    });
    return this.#connecting;
  }

  onRecord(listener: (record: AgentRecord) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  hello(name: string): Promise<AgentHelloData> {
    return this.#send<AgentHelloData>({ type: "hello", name });
  }

  state(): Promise<AgentStateData> {
    return this.#send<AgentStateData>({ type: "state" });
  }

  prompt(text: string): Promise<{ accepted: boolean }> {
    return this.#send<{ accepted: boolean }>({ type: "prompt", text });
  }

  abort(): Promise<{ aborted: boolean }> {
    return this.#send<{ aborted: boolean }>({ type: "abort" });
  }

  clear(): Promise<AgentClearData> {
    return this.#send<AgentClearData>({ type: "clear" });
  }

  systemPrompt(): Promise<AgentPromptFileData> {
    return this.#send<AgentPromptFileData>({ type: "system_prompt" });
  }

  saveSystemPrompt(text: string): Promise<AgentPromptFileData> {
    return this.#send<AgentPromptFileData>({ type: "system_prompt_save", text });
  }

  cwd(): Promise<AgentCwdData> {
    return this.#send<AgentCwdData>({ type: "cwd" });
  }

  setCwd(path: string): Promise<AgentCwdData> {
    return this.#send<AgentCwdData>({ type: "cwd_set", path });
  }

  setMode(mode: ChatMode): Promise<AgentModeData> {
    return this.#send<AgentModeData>({ type: "mode_set", mode });
  }

  answerDecision(toolCallId: string, answers: DecisionAnswer[]): Promise<AgentDecisionData> {
    return this.#send<AgentDecisionData>({ type: "decision_answer", toolCallId, answers });
  }

  sessionList(): Promise<AgentSessionListData> {
    return this.#send<AgentSessionListData>({ type: "session_list" });
  }

  switchSession(sessionId: string): Promise<AgentSessionData> {
    return this.#send<AgentSessionData>({ type: "session_switch", sessionId });
  }

  status(): Promise<AgentStatus> {
    return invoke<AgentStatus>("agent_status");
  }

  async waitUntilConnected(timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = await this.status();
      if (status.error) throw new Error(status.error);
      if (status.connected) return;
      if (Date.now() >= deadline) {
        throw new Error("agent sidecar did not start in time");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  #dispatch(record: AgentRecord): void {
    if (record.type === "response") {
      const pending = this.#pending.get(record.id);
      if (pending) {
        this.#pending.delete(record.id);
        if (record.ok) pending.resolve(record.data);
        else pending.reject(new Error(record.error));
      }
    }

    if (record.type === "closed") {
      this.#failPending(new Error(record.reason));
    }

    for (const listener of this.#listeners) listener(record);
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  async #send<T>(request: Omit<AgentRequest, "id">): Promise<T> {
    const id = `req-${(this.#counter += 1)}`;
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });

    try {
      await invoke("agent_request", { payload: { ...request, id } });
    } catch (error) {
      this.#pending.delete(id);
      throw error;
    }

    return (await response) as T;
  }
}

let singleton: AgentClient | undefined;

export function agentClient(): AgentClient {
  singleton ??= new AgentClient();
  return singleton;
}
