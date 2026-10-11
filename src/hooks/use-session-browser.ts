import { useCallback, useState } from "react";
import type { AgentSessionSummary } from "@shared/protocol";
import type { AgentClient } from "@/lib/agent/client";
import { describe } from "@/lib/chat/agent-helpers";

export interface SessionBrowserState {
  loading: boolean;
  error: string | null;
  sessions: AgentSessionSummary[];
}

export interface SessionBrowser {
  state: SessionBrowserState | null;
  open(): void;
  close(): void;
  load(): Promise<AgentSessionSummary[]>;
  search(query: string): Promise<string[]>;
}

export function useSessionBrowser(client: AgentClient): SessionBrowser {
  const [state, setState] = useState<SessionBrowserState | null>(null);

  const load = useCallback(
    async (): Promise<AgentSessionSummary[]> => (await client.sessionList()).sessions,
    [client],
  );

  const search = useCallback(
    async (query: string): Promise<string[]> => (await client.sessionSearch(query)).ids,
    [client],
  );

  const open = useCallback(() => {
    setState({ loading: true, error: null, sessions: [] });
    load()
      .then((sessions) => {
        setState((current) => (current ? { loading: false, error: null, sessions } : current));
      })
      .catch((error: unknown) => {
        setState((current) =>
          current ? { loading: false, error: describe(error), sessions: [] } : current,
        );
      });
  }, [load]);

  const close = useCallback(() => setState(null), []);

  return { state, open, close, load, search };
}
