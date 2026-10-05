import { Button } from "@/components/ui/button";
import { modeLabel } from "@/lib/chat/commands";
import type { ConfirmMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const TONES = {
  pending: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  confirmed: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  cancelled: "bg-muted text-muted-foreground",
} as const;

export function ConfirmCard({
  message,
  onAnswer,
}: {
  message: ConfirmMessage;
  onAnswer: (yes: boolean) => void;
}) {
  const mode = modeLabel(message.switchTo);
  const pending = message.answer === null;
  const tone = pending ? TONES.pending : message.answer === "yes" ? TONES.confirmed : TONES.cancelled;

  return (
    <div className={cn("px-4 py-3 text-[15px] leading-7", tone)}>
      <p className={cn(message.answer === "yes" ? "font-bold" : "font-semibold")}>
        {pending ? message.title : message.answer === "yes" ? "CONFIRMED" : "CANCELLED"}
      </p>
      <p className="mt-1 whitespace-pre-wrap">
        {pending
          ? message.text
          : message.answer === "yes"
            ? `已切换为 ${mode} 模式`
            : `取消切换到 ${mode} 模式`}
      </p>
      {pending ? (
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => onAnswer(true)}>
            是
            <Shortcut>Enter</Shortcut>
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAnswer(false)}>
            否
            <Shortcut>Backspace</Shortcut>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Shortcut({ children }: { children: string }) {
  return (
    <span className="rounded border border-current/30 px-1 text-[10px] opacity-70">
      {children}
    </span>
  );
}
