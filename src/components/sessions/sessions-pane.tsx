import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import type { AgentSessionSummary } from "@shared/protocol";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import type { SessionBrowserState } from "@/hooks/use-agent-chat";
import { formatDateTime, formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";

export function SessionsPane({
  state,
  onSelect,
  onSearch,
  onClose,
}: {
  state: SessionBrowserState;
  onSelect(sessionId: string): Promise<void>;
  onSearch(query: string): Promise<string[]>;
  onClose(): void;
}) {
  const { sessions, loading, error } = state;
  const [query, setQuery] = useState("");
  const [matched, setMatched] = useState<string[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef(false);

  const keyword = query.trim();
  const visible = useMemo(
    () => (matched ? sessions.filter((session) => matched.includes(session.id)) : sessions),
    [sessions, matched],
  );

  useEffect(() => {
    setSelected(0);
    setPendingId(null);
    setSwitchError(null);
    pendingRef.current = false;
  }, [sessions]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    setSelected(0);
    if (!keyword) {
      setMatched(null);
      return;
    }
    let cancelled = false;
    onSearch(keyword)
      .then((ids) => {
        if (!cancelled) setMatched(ids);
      })
      .catch(() => {
        if (!cancelled) setMatched([]);
      });
    return () => {
      cancelled = true;
    };
  }, [keyword, onSearch]);

  useEffect(() => {
    setSelected((index) => Math.min(index, Math.max(visible.length - 1, 0)));
  }, [visible.length]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected, visible]);

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

  const handlers = useRef({ visible, selected, choose, onClose, keyword, setQuery });
  handlers.current = { visible, selected, choose, onClose, keyword, setQuery };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const current = handlers.current;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, Math.max(current.visible.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        current.choose(current.visible[current.selected]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (current.keyword) {
          current.setQuery("");
          return;
        }
        current.onClose();
      } else if (event.key.length === 1 && event.key !== " ") {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const notice = switchError ?? error;

  return (
    <section className="ar-background flex h-svh flex-col text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-4 pt-3 text-[15px] leading-7 font-semibold">SESSIONS</p>

        {notice ? (
          <p className="px-4 py-2 text-xs break-words text-destructive">{notice}</p>
        ) : null}

        {!loading && visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {keyword ? "没有匹配的会话。" : "还没有会话。"}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {visible.map((session, index) => {
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
                    onMouseMove={(event) => {
                      // 忽略布局变化后浏览器补发的合成 mousemove，避免进入页面时高亮行自己跳走
                      if (event.movementX === 0 && event.movementY === 0) return;
                      setSelected(index);
                    }}
                    disabled={pendingId !== null}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 border-b px-4 py-3 text-left",
                      active ? "bg-accent text-accent-foreground" : null,
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

      <div
        className={cn(
          "shrink-0 px-4",
          query ? "border-t py-2.5" : "h-0 overflow-hidden",
        )}
      >
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            value={query}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            aria-label="搜索会话"
            placeholder="输入关键词，按 id 或会话内容搜索"
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      </div>
    </section>
  );
}
