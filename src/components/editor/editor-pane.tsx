import { useEffect, useState } from "react";
import { CodeEditor } from "@/components/editor/code-editor";
import { useLatestRef } from "@/hooks/use-latest-ref";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface EditorPaneProps {
  fileName: string;
  filePath?: string;
  value: string;
  savedValue: string;
  saving?: boolean;
  error?: string | null;
  onChange(value: string): void;
  onSave(): boolean | Promise<boolean>;
  onClose(): void;
}

export function EditorPane({
  fileName,
  filePath,
  value,
  savedValue,
  saving = false,
  error = null,
  onChange,
  onSave,
  onClose,
}: EditorPaneProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dirty = value !== savedValue;

  const requestClose = () => {
    if (dirty) setConfirmOpen(true);
    else onClose();
  };

  const saveAndClose = async () => {
    setConfirmOpen(false);
    const saved = await onSave();
    if (saved !== false) onClose();
  };

  const handlers = useLatestRef({ onSave, onClose, dirty, confirmOpen, saveAndClose, requestClose });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void handlers.current.onSave();
      } else if (key === "w") {
        event.preventDefault();
        const state = handlers.current;
        if (!state.dirty) state.onClose();
        else if (state.confirmOpen) void state.saveAndClose();
        else state.requestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);

  return (
    <section className="flex h-svh flex-col">
      <header className="shrink-0 border-b">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium" title={filePath}>
              {fileName}
            </span>
            {dirty ? <Badge variant="secondary">未保存</Badge> : null}
          </div>
          {dirty ? (
            <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
              <PopoverTrigger asChild>
                <Button size="xs" variant="outline" disabled={saving}>
                  {saving ? "保存中" : "关闭"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <PopoverHeader>
                  <PopoverTitle>还有未保存的修改</PopoverTitle>
                  <PopoverDescription>关闭前先保存，还是放弃这次修改？</PopoverDescription>
                </PopoverHeader>
                <div className="flex flex-col gap-2">
                  <Button size="sm" onClick={saveAndClose} disabled={saving}>
                    保存并关闭
                    <span className="opacity-70">⌘W</span>
                  </Button>
                  <Button size="sm" variant="destructive" onClick={onClose} disabled={saving}>
                    放弃并关闭
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Button size="xs" variant="outline" onClick={requestClose}>
              关闭
            </Button>
          )}
        </div>
      </header>
      {error ? (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <CodeEditor value={value} onChange={onChange} />
    </section>
  );
}
