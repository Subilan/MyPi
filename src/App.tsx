import { Suspense, lazy, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Composer } from "@/components/chat/composer";
import { JumpView } from "@/components/chat/jump-view";
import { Transcript } from "@/components/chat/transcript";
import { SessionsPane } from "@/components/sessions/sessions-pane";
import { Toaster } from "@/components/ui/sonner";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { useEditorDocument } from "@/hooks/use-editor-document";
import { agentClient, isTauriRuntime } from "@/lib/agent/client";
import { applyThemeCss } from "@/lib/theme";

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
      .then((data) => open("system-prompt", fileName(data.path), data.path, data.text))
      .catch((error: unknown) => toast.error(describe(error)));
  }, [client, open]);

  const openTheme = useCallback(() => {
    void client
      .theme()
      .then((data) => open("theme", fileName(data.path), data.path, data.text))
      .catch((error: unknown) => toast.error(describe(error)));
  }, [client, open]);

  const chat = useAgentChat({ onEditSystemPrompt: openSystemPrompt, onEditTheme: openTheme });

  const saveDocument = useCallback(async (): Promise<boolean> => {
    if (!editorDocument) return false;
    if (editorDocument.value === editorDocument.savedValue) return true;
    if (editorDocument.saving) return false;
    startSaving();
    try {
      if (editorDocument.target === "theme") {
        const data = await client.saveTheme(editorDocument.value);
        applyThemeCss(data.text);
        markSaved(data.text);
      } else {
        const data = await client.saveSystemPrompt(editorDocument.value);
        markSaved(data.text);
      }
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
      ) : chat.sessionBrowser ? (
        <SessionsPane
          state={chat.sessionBrowser}
          onSelect={chat.switchSession}
          onSearch={chat.searchSessions}
          onClose={chat.closeSessionBrowser}
        />
      ) : chat.jumpTree ? (
        <JumpView
          tree={chat.jumpTree}
          mode={chat.mode}
          onCommit={chat.commitJump}
          onCancel={chat.closeJumpView}
        />
      ) : (
        <main className="ar-background flex h-svh flex-col text-foreground">
          {notice ? (
            <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs break-words text-destructive">
              {notice}
            </div>
          ) : null}

          <Transcript
            messages={chat.messages}
            mode={chat.mode}
            running={chat.running}
            waitingForUser={chat.waitingForUser}
            runStartedAt={chat.runStartedAt}
            onDecisionAnswer={chat.answerDecision}
            onConfirmAnswer={chat.answerConfirm}
          />
          <Composer
            running={chat.running}
            locked={chat.confirmPending}
            seed={chat.composerSeed}
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
