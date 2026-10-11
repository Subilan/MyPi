import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { AgentRecord, AgentRuntimeInfo } from "@shared/protocol";
import { useLatestRef } from "@/hooks/use-latest-ref";
import { isTauriRuntime, type AgentClient } from "@/lib/agent/client";
import { describe } from "@/lib/chat/agent-helpers";
import { applyThemeCss } from "@/lib/theme";

export interface AgentConnectionHandlers {
  onRecord(record: AgentRecord): void;
  onReady(runtime: AgentRuntimeInfo): void;
}

export interface AgentConnection {
  runtime: AgentRuntimeInfo | null;
  setRuntime: Dispatch<SetStateAction<AgentRuntimeInfo | null>>;
  bridgeError: string | null;
  configError: string | null;
}

export function useAgentConnection(
  client: AgentClient,
  handlers: AgentConnectionHandlers,
): AgentConnection {
  const [runtime, setRuntime] = useState<AgentRuntimeInfo | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(() =>
    isTauriRuntime() ? null : "当前不是 Tauri 运行环境，请用 npm run tauri dev 启动。",
  );
  const onRecordRef = useLatestRef(handlers.onRecord);
  const onReadyRef = useLatestRef(handlers.onReady);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const off = client.onRecord((record) => {
      if (record.type === "closed") setBridgeError(record.reason);
      onRecordRef.current(record);
    });

    void (async () => {
      try {
        await client.connect();
        await client.waitUntilConnected();
        const hello = await client.hello("world");
        setRuntime(hello.runtime);
        onReadyRef.current(hello.runtime);
        await client
          .theme()
          .then((data) => applyThemeCss(data.text))
          .catch(() => undefined);
      } catch (error) {
        setBridgeError(describe(error));
      }
    })();

    return off;
  }, [client, onReadyRef, onRecordRef]);

  return { runtime, setRuntime, bridgeError, configError: runtime?.configError ?? null };
}
