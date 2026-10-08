import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ChatMode } from "@shared/protocol";
import { isHidden, toolDetail } from "@/components/chat/transcript";
import { parseCommand } from "@/lib/chat/commands";
import type { ChatMessage } from "@/lib/chat/types";
import {
  defaultTarget,
  entryToMessage,
  isDisplayableEntry,
  lastEntryId,
  pathTo,
  projectTree,
  type ChatTree,
} from "@/lib/chat/tree";
import { cn } from "@/lib/utils";

const DELIVER_FIELD: Record<string, string> = {
  report_success: "description",
  report_failure: "reason",
  request_user_decision: "question",
};

function argObject(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function previewText(message: ChatMessage): string {
  switch (message.role) {
    case "user":
    case "assistant":
    case "error":
      return message.text;
    case "notice":
      return [message.title, message.text].filter((part) => part.length > 0).join(" ");
    case "tool": {
      const field = DELIVER_FIELD[message.name];
      if (field) {
        const value = argObject(message.args)[field];
        if (typeof value === "string" && value.length > 0) return value;
      }
      return [message.name, toolDetail(message)].filter((part) => part.length > 0).join(" ");
    }
    case "confirm":
      return message.text;
  }
}

function rowSurface(message: ChatMessage): { className: string; status?: string; tone?: string } {
  switch (message.role) {
    case "user":
      return { className: "mypi-message-user" };
    case "tool":
      return { className: "mypi-message-tool", status: message.status };
    case "notice":
      return { className: "mypi-message-system", tone: "info" };
    case "error":
      return { className: "mypi-message-system", tone: "critical" };
    case "confirm":
      return {
        className: "mypi-message-system",
        tone:
          message.answer === "yes" ? "success" : message.answer === "no" ? "neutral" : "warning",
      };
    default:
      return { className: "mypi-message-assistant" };
  }
}

export function JumpView({
  tree,
  mode,
  onCommit,
  onCancel,
}: {
  tree: ChatTree;
  mode: ChatMode;
  onCommit(nodeId: string): void;
  onCancel(): void;
}) {
  const visible = useMemo(
    () =>
      projectTree(
        tree,
        (entry) => isDisplayableEntry(entry) && !isHidden(entryToMessage(entry), mode),
      ),
    [tree, mode],
  );

  const visibleHead = visible.head;
  const initialTarget = visibleHead ? defaultTarget(visible, visibleHead) : lastEntryId(visible);
  const [target, setTarget] = useState<string | null>(initialTarget);
  const path = useMemo(() => (target ? pathTo(visible, target) : []), [visible, target]);
  const [selected, setSelected] = useState(() => {
    if (visibleHead) {
      const headPath = pathTo(visible, visibleHead);
      if (headPath.length > 0) return headPath.length - 1;
    }
    const initial = initialTarget ? pathTo(visible, initialTarget) : [];
    return Math.max(initial.length - 1, 0);
  });
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    setSelected((index) => Math.min(index, Math.max(path.length - 1, 0)));
  }, [path.length]);

  useEffect(() => {
    const id = path[selected];
    if (id) rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
  }, [selected, path]);

  const roots = useMemo(
    () =>
      [...visible.byId.values()]
        .filter((node) => node.parent === null)
        .map((node) => node.entry.id),
    [visible],
  );

  const switchBranch = useCallback(
    (nodeId: string, direction: -1 | 1) => {
      const node = visible.byId.get(nodeId);
      if (!node) return;
      const forkIndex = Math.max(path.indexOf(nodeId), 0);
      if (node.children.length > 1) {
        const childOnPath = path[forkIndex + 1];
        const currentIndex = childOnPath ? node.children.indexOf(childOnPath) : -1;
        const nextIndex =
          currentIndex < 0
            ? direction > 0
              ? 0
              : node.children.length - 1
            : (currentIndex + direction + node.children.length) % node.children.length;
        setTarget(defaultTarget(visible, node.children[nextIndex]));
        return;
      }
      if (node.parent === null && roots.length > 1) {
        const index = roots.indexOf(nodeId);
        const next = (index + direction + roots.length) % roots.length;
        setTarget(defaultTarget(visible, roots[next]));
      }
    },
    [path, roots, visible],
  );

  const handlers = useRef({ path, selected, switchBranch, onCommit, onCancel });
  handlers.current = { path, selected, switchBranch, onCommit, onCancel };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const current = handlers.current;
      if (event.key === "Escape") {
        event.preventDefault();
        current.onCancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const id = current.path[current.selected];
        if (id) current.onCommit(id);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, Math.max(current.path.length - 1, 0)));
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const nodeId = current.path[current.selected];
        if (nodeId) {
          current.switchBranch(nodeId, event.key === "ArrowLeft" ? -1 : 1);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedNode = path[selected] ? visible.byId.get(path[selected]) : undefined;

  return (
    <section className="flex h-svh flex-col">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="flex w-full flex-col pb-6">
          {path.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              当前会话还没有可以跳转的消息。
            </p>
          ) : (
            path.map((id, index) => {
              const node = visible.byId.get(id);
              if (!node) return null;
              const message = entryToMessage(node.entry);
              const surface = rowSurface(message);
              const active = index === selected;
              const fork = node.children.length > 1 || (node.parent === null && roots.length > 1);
              const isCommand = message.role === "user" && parseCommand(message.text) !== null;
              return (
                <div
                  key={id}
                  ref={(element) => {
                    if (element) rowRefs.current.set(id, element);
                    else rowRefs.current.delete(id);
                  }}
                  className={cn("relative", active && "jump-selected")}
                >
                  <div
                    onClick={() => setSelected(index)}
                    data-status={surface.status}
                    data-tone={surface.tone}
                    className={cn("px-4 py-2", surface.className)}
                  >
                    <p
                      className={cn(
                        "truncate text-[15px] leading-7",
                        isCommand && "font-bold text-primary",
                      )}
                    >
                      {previewText(message)}
                    </p>
                  </div>
                  {fork ? (
                    <>
                      <button
                        type="button"
                        aria-label="上一个分支"
                        onClick={() => {
                          setSelected(index);
                          switchBranch(id, -1);
                        }}
                        className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-r-md border border-l-0 border-border bg-background/85 py-1 pr-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronLeftIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="下一个分支"
                        onClick={() => {
                          setSelected(index);
                          switchBranch(id, 1);
                        }}
                        className="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-l-md border border-r-0 border-border bg-background/85 py-1 pl-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronRightIcon className="size-4" />
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-4 py-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">JUMP</span>
        <span>↑/↓ 选择消息</span>
        <span>←/→ 切换分支</span>
        <span>Enter 跳转</span>
        <span>Esc 取消</span>
        {selectedNode &&
        (selectedNode.children.length > 1 || (selectedNode.parent === null && roots.length > 1)) ? (
          <span className="tabular-nums">
            {selectedNode.children.length > 1
              ? `该消息有 ${selectedNode.children.length} 个分支`
              : `根层有 ${roots.length} 个分支`}
          </span>
        ) : null}
      </footer>
    </section>
  );
}
