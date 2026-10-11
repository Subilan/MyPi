import { useEffect, useState } from "react";
import { formatDuration, nowMs } from "@/lib/time";

const DOT_INTERVAL_MS = 400;
const TICK_MS = 200;

export function ThinkingIndicator({
  startedAt,
  label = "Thinking",
}: {
  startedAt: number;
  label?: string;
}) {
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMs()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsed = Math.max(0, now - startedAt);
  const dots = ".".repeat(1 + (Math.floor(elapsed / DOT_INTERVAL_MS) % 3));

  return (
    <p className="text-muted-foreground">
      {label}
      <span className="inline-block min-w-[1.5ch]">{dots}</span>
      <span className="ml-2 text-xs tabular-nums">{formatDuration(elapsed)}</span>
    </p>
  );
}
