import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpIcon, CircleStopIcon } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isTauriRuntime } from "@/lib/agent/client";
import { parseCommand } from "@/lib/chat/commands";
import { insertPaths } from "@/lib/chat/drop-paths";
import { nowMs } from "@/lib/time";
import { cn } from "@/lib/utils";

const MAX_HEIGHT_PX = 200;

function isEditable(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT";
}

export function Composer({
  running,
  locked,
  history,
  seed,
  onSend,
  onStop,
}: {
  running: boolean;
  locked: boolean;
  history: string[];
  seed?: { text: string; nonce: number } | null;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stashRef = useRef("");
  const draftRef = useRef("");
  const caretToEndRef = useRef(false);
  const caretRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const isCommand = parseCommand(draft) !== null;

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const seedNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!seed || seed.nonce === seedNonceRef.current) return;
    seedNonceRef.current = seed.nonce;
    caretToEndRef.current = true;
    setDraft(seed.text);
    setHistoryIndex(null);
    textareaRef.current?.focus({ preventScroll: true });
  }, [seed]);

  useEffect(() => {
    const focusComposer = () => textareaRef.current?.focus({ preventScroll: true });
    focusComposer();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key.toLowerCase() !== "i" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      focusComposer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    if (caretToEndRef.current) {
      caretToEndRef.current = false;
      node.setSelectionRange(node.value.length, node.value.length);
      return;
    }
    if (caretRef.current !== null) {
      const caret = caretRef.current;
      caretRef.current = null;
      node.focus({ preventScroll: true });
      node.setSelectionRange(caret, caret);
    }
  }, [draft]);

  const addPaths = useCallback((paths: string[]) => {
    const node = textareaRef.current;
    const current = draftRef.current;
    const start = node?.selectionStart ?? current.length;
    const end = node?.selectionEnd ?? current.length;
    const result = insertPaths(current, start, end, paths);
    if (!result) return;
    setDraft(result.text);
    setHistoryIndex(null);
    caretRef.current = result.caret;
  }, []);

  const withinComposer = useCallback((position: { x: number; y: number }) => {
    const node = rootRef.current;
    if (!node) return false;
    const scale = window.devicePixelRatio || 1;
    const rect = node.getBoundingClientRect();
    const x = position.x / scale;
    const y = position.y / scale;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(withinComposer(payload.position));
          return;
        }
        setDragging(false);
        if (payload.type === "drop") addPaths(payload.paths);
      })
      .then((off) => {
        if (cancelled) off();
        else unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [addPaths, withinComposer]);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT_PX)}px`;
    node.style.overflowY = node.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [draft]);

  const recall = (index: number | null) => {
    const text = index === null ? stashRef.current : (history[index] ?? "");
    if (text !== draft) {
      caretToEndRef.current = true;
      setDraft(text);
    }
    setHistoryIndex(index);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || running || locked) return;
    setDraft("");
    setHistoryIndex(null);
    stashRef.current = "";
    onSend(text);
    textareaRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      data-dragging={dragging ? "true" : undefined}
      className="mypi-composer shrink-0 transition-colors"
    >
      <div className="flex w-full items-end gap-2 px-4 py-3">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          placeholder={
            locked
              ? "请先在聊天记录里回答确认（Enter 是 / Backspace 否）"
              : dragging
                ? "松开鼠标，把文件路径插入输入框"
                : undefined
          }
          disabled={locked}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          {...({ writingsuggestions: "false" } as Record<string, string>)}
          className={cn(
            "mypi-composer-input min-h-9 flex-1 resize-none field-sizing-fixed px-3 py-1.5 text-[15px] leading-6 md:text-[15px]",
            isCommand ? "font-bold text-primary" : null,
            dragging ? "border-primary ring-3 ring-ring/40" : null,
          )}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            compositionEndedAtRef.current = nowMs();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const files = Array.from(event.dataTransfer?.files ?? []);
            addPaths(files.map((file) => (file as File & { path?: string }).path ?? file.name));
          }}
          onKeyDown={(event) => {
            const native = event.nativeEvent;
            if (native.isComposing || composingRef.current || native.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft("");
              setHistoryIndex(null);
              stashRef.current = "";
              return;
            }
            const plain = !event.shiftKey && !event.altKey && !(event.metaKey || event.ctrlKey);
            if (plain && event.key === "ArrowUp") {
              if (history.length === 0) return;
              event.preventDefault();
              if (historyIndex === null) {
                stashRef.current = draft;
                recall(history.length - 1);
              } else if (historyIndex > 0) {
                recall(historyIndex - 1);
              }
              return;
            }
            if (plain && event.key === "ArrowDown") {
              if (historyIndex === null) return;
              event.preventDefault();
              if (historyIndex < history.length - 1) recall(historyIndex + 1);
              else recall(null);
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            if (nowMs() - compositionEndedAtRef.current < 100) return;
            submit();
          }}
        />
        {running ? (
          <Button size="icon" variant="outline" onClick={onStop} aria-label="停止">
            <CircleStopIcon />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} disabled={!draft.trim() || locked} aria-label="发送">
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </div>
  );
}
