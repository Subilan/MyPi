import { Suspense, lazy, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Composer } from "@/components/chat/composer";
import { Transcript } from "@/components/chat/transcript";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { useEditorDocument } from "@/hooks/use-editor-document";
import { agentClient, isTauriRuntime } from "@/lib/agent/client";
import { modeLabel } from "@/lib/chat/commands";

const EditorPane = lazy(() =>
  import("@/components/editor/editor-pane").then((module) => ({ default: module.EditorPane })),
);

export default function App() {
  const client = agentClient();
  const {
    document: editorDocument,
    open,
    change,
    startSaving,
    markSaved,
    fail,
    close,
  } = useEditorDocument();

  const openSystemPrompt = useCallback(() => {
    void client
      .systemPrompt()
      .then((data) => open(fileName(data.path), data.path, data.text))
      .catch((error: unknown) => toast.error(describe(error)));
  }, [client, open]);

  const chat = useAgentChat({ onEditSystemPrompt: openSystemPrompt });

  const saveDocument = useCallback(async (): Promise<boolean> => {
    if (!editorDocument) return false;
    if (editorDocument.value === editorDocument.savedValue) return true;
    if (editorDocument.saving) return false;
    startSaving();
    try {
      const data = await client.saveSystemPrompt(editorDocument.value);
      markSaved(data.text);
      return true;
    } catch (error: unknown) {
      fail(describe(error));
      return false;
    }
  }, [client, editorDocument, fail, markSaved, startSaving]);

  useEffect(() => {
    if (editorDocument || !isTauriRuntime()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "w") return;
      event.preventDefault();
      void getCurrentWindow().close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorDocument]);

  const notice = chat.bridgeError ?? chat.configError;

  return (
    <>
      {editorDocument ? (
        <Suspense
          fallback={
            <main className="flex h-svh items-center justify-center text-sm text-muted-foreground">
              正在打开编辑器…
            </main>
          }
        >
          <EditorPane
            fileName={editorDocument.fileName}
            filePath={editorDocument.filePath}
            value={editorDocument.value}
            savedValue={editorDocument.savedValue}
            saving={editorDocument.saving}
            error={editorDocument.error}
            onChange={change}
            onSave={saveDocument}
            onClose={close}
          />
        </Suspense>
      ) : (
        <main className="flex h-svh flex-col bg-background text-foreground">
          <header className="shrink-0 border-b">
            <div className="flex w-full items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm font-medium">agent-runbook</span>
                {chat.runtime ? (
                  <Badge variant="outline" className="font-mono">
                    {chat.runtime.provider}/{chat.runtime.model}
                  </Badge>
                ) : null}
                <Badge variant={chat.mode === "deliver" ? "default" : "outline"}>
                  {modeLabel(chat.mode)}
                </Badge>
                {chat.runtime ? (
                  <Badge
                    variant="outline"
                    className="min-w-0 max-w-80 truncate font-mono"
                    title={chat.runtime.workdir}
                  >
                    {chat.runtime.workdir}
                  </Badge>
                ) : null}
              </div>
              <Badge variant={chat.running ? "default" : "secondary"}>
                {chat.running ? "running" : "idle"}
              </Badge>
            </div>
          </header>

          {notice ? (
            <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs break-words text-destructive">
              {notice}
            </div>
          ) : null}

          <Transcript
            messages={chat.messages}
            mode={chat.mode}
            running={chat.running}
            runStartedAt={chat.runStartedAt}
            onDecisionAnswer={chat.answerDecision}
          />
          <Composer
            running={chat.running}
            history={chat.messages
              .filter((message) => message.role === "user")
              .map((message) => message.text)}
            onSend={chat.send}
            onStop={chat.stop}
          />
        </main>
      )}
      <Toaster />
    </>
  );
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
