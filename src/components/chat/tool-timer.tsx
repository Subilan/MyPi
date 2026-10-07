import { useEffect, useState } from "react";
import { formatElapsed, nowMs } from "@/lib/time";

const TICK_FAST_MS = 100;
const TICK_SLOW_MS = 1000;

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
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    if (!running) return;
    let timer = 0;
    const tick = () => {
      const current = nowMs();
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
