import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSessionSummary } from "@shared/protocol";
import { Badge } from "@/components/ui/badge";
import type { SessionBrowserState } from "@/hooks/use-agent-chat";
import { formatDateTime, formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";

export function SessionsPane({
  state,
  onSelect,
  onClose,
}: {
  state: SessionBrowserState;
  onSelect(sessionId: string): Promise<void>;
  onClose(): void;
}) {
  const { sessions, loading, error } = state;
  const [selected, setSelected] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pendingRef = useRef(false);

  useEffect(() => {
    setSelected(0);
    setPendingId(null);
    setSwitchError(null);
    pendingRef.current = false;
  }, [sessions]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, sessions]);

  const choose = useCallback(
    (session: AgentSessionSummary | undefined) => {
      if (!session || pendingRef.current) return;
      pendingRef.current = true;
      setPendingId(session.id);
      setSwitchError(null);
      void onSelect(session.id).catch((cause: unknown) => {
        pendingRef.current = false;
        setPendingId(null);
        setSwitchError(cause instanceof Error ? cause.message : String(cause));
      });
    },
    [onSelect],
  );

  const handlers = useRef({ sessions, selected, choose, onClose });
  handlers.current = { sessions, selected, choose, onClose };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const current = handlers.current;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, Math.max(current.sessions.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        current.choose(current.sessions[current.selected]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        current.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const notice = switchError ?? error;

  return (
    <section className="flex h-svh flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-4 pt-3 text-[15px] leading-7 font-semibold">SESSIONS</p>

        {notice ? (
          <p className="px-4 py-2 text-xs break-words text-destructive">{notice}</p>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">还没有会话。</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {sessions.map((session, index) => {
              const active = index === selected;
              const pending = pendingId === session.id;
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    onClick={() => choose(session)}
                    onMouseEnter={() => setSelected(index)}
                    disabled={pendingId !== null}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 border-b px-4 py-3 text-left transition-colors",
                      active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                      pendingId !== null && !pending ? "opacity-60" : null,
                    )}
                  >
                    <span className="flex w-full items-baseline justify-between gap-3">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-medium break-all">{session.id}</span>
                        {session.current ? <Badge variant="secondary">当前</Badge> : null}
                        {pending ? (
                          <span className="text-xs text-muted-foreground">切换中…</span>
                        ) : null}
                      </span>
                      <span
                        className="shrink-0 text-xs text-muted-foreground"
                        title={formatDateTime(session.startedAt)}
                      >
                        {formatRelative(session.startedAt)}
                      </span>
                    </span>
                    <span className="w-full truncate text-sm text-muted-foreground">
                      {session.preview || "(还没有消息)"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
