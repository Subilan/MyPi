import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/chat/duration";

const DOT_INTERVAL_MS = 400;
const TICK_MS = 200;

export function ThinkingIndicator({
  startedAt,
  label = "Thinking",
}: {
  startedAt: number;
  label?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
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
