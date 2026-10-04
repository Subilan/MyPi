import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const STYLES = {
  success: {
    wrapper: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  failure: {
    wrapper: "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
    icon: "text-red-600 dark:text-red-400",
  },
} as const;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

export function DeliveryCard({
  status,
  args,
}: {
  status: "success" | "failure";
  args: unknown;
}) {
  const data = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const style = STYLES[status];
  const body = status === "success" ? readString(data.description) : readString(data.reason);
  const nextSteps = status === "success" ? readStrings(data.nextSteps) : [];
  const suggestion = status === "failure" ? readString(data.suggestion) : null;

  return (
    <div className={cn("px-4 py-3 text-[15px] leading-7", style.wrapper)}>
      <p className={cn("flex items-center gap-2", status === "success" ? "font-bold" : "font-semibold")}>
        {status === "success" ? (
          <CheckIcon className={style.icon} />
        ) : (
          <AlertTriangleIcon className={style.icon} />
        )}
        {status === "success" ? "已完成" : "无法完成"}
      </p>
      {body ? <p className="mt-1 whitespace-pre-wrap">{body}</p> : null}
      {nextSteps.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs opacity-70">建议的下一步</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {nextSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {suggestion ? <p className="mt-3 opacity-80">建议：{suggestion}</p> : null}
    </div>
  );
}
