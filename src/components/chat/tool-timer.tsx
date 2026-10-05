import { useEffect, useState } from "react";

const TICK_FAST_MS = 100;
const TICK_SLOW_MS = 1000;

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

export function ToolTimer({
  startedAt,
  finishedAt,
  timeoutMs,
}: {
  startedAt: number;
  finishedAt: number | null;
  timeoutMs?: number;
}) {
  const running = finishedAt === null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      timer = window.setTimeout(
        tick,
        current - startedAt < 1000 ? TICK_FAST_MS : TICK_SLOW_MS,
      );
    };
    timer = window.setTimeout(tick, TICK_FAST_MS);
    return () => window.clearTimeout(timer);
  }, [running, startedAt]);

  const elapsed = Math.max(0, (finishedAt ?? now) - startedAt);
  const text = formatElapsed(elapsed);
  return <>{timeoutMs ? `${text}/${Math.round(timeoutMs / 1000)}s` : text}</>;
}
