import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { isTauriRuntime } from "@/lib/agent/client";
import { cn } from "@/lib/utils";

const TONES = {
  success: "success",
  failure: "critical",
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

function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function toLocalPath(value: string): string {
  if (!value.toLowerCase().startsWith("file://")) return value;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}

async function openArtifact(target: string): Promise<void> {
  try {
    if (isWebUrl(target)) {
      if (isTauriRuntime()) await openUrl(target);
      else window.open(target, "_blank", "noreferrer");
      return;
    }
    if (!isTauriRuntime()) {
      toast.error("浏览器环境无法打开本地路径");
      return;
    }
    await openPath(toLocalPath(target));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export function DeliveryCard({
  status,
  args,
}: {
  status: "success" | "failure";
  args: unknown;
}) {
  const data = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const tone = TONES[status];
  const body = status === "success" ? readString(data.description) : readString(data.reason);
  const artifacts = status === "success" ? readStrings(data.artifacts) : [];
  const nextSteps = status === "success" ? readStrings(data.nextSteps) : [];
  const suggestions = status === "failure" ? readStrings(data.suggestion) : [];

  return (
    <div data-tone={tone} className="mypi-message-system px-4 py-3 text-[15px] leading-7">
      <p className={cn(status === "success" ? "font-bold" : "font-semibold")}>
        {status === "success" ? "DONE" : "FAILURE"}
      </p>
      {body ? <p className="mt-1 whitespace-pre-wrap">{body}</p> : null}
      {artifacts.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold opacity-70">ARTIFACTS</p>
          <ul className="mt-1 flex flex-col gap-1">
            {artifacts.map((artifact, index) => (
              <li key={index}>
                <button
                  type="button"
                  title={artifact}
                  className="max-w-full cursor-pointer text-left break-all underline underline-offset-4 hover:opacity-80"
                  onClick={() => void openArtifact(artifact)}
                >
                  {artifact}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {nextSteps.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold opacity-70">NEXT STEPS</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {nextSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold opacity-70">SUGGESTIONS</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {suggestions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
