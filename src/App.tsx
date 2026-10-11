import { Suspense, lazy, useCallback, useEffect, useMemo } from "react";
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
import { describe } from "@/lib/chat/agent-helpers";
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
  const { transcript, sessions, jump, runtime } = chat;

  const history = useMemo(
    () =>
      transcript.messages.flatMap((message) => (message.role === "user" ? [message.text] : [])),
    [transcript.messages],
  );

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

  const notice = runtime.bridgeError ?? runtime.configError;

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
      ) : sessions.browser ? (
        <SessionsPane
          state={sessions.browser}
          onSelect={sessions.switchTo}
          onSearch={sessions.search}
          onClose={sessions.close}
        />
      ) : jump.tree ? (
        <JumpView
          tree={jump.tree}
          mode={runtime.mode}
          onCommit={jump.commit}
          onCancel={jump.close}
        />
      ) : (
        <main className="flex h-svh flex-col">
          {notice ? (
            <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs break-words text-destructive">
              {notice}
            </div>
          ) : null}

          <Transcript
            messages={transcript.messages}
            mode={runtime.mode}
            running={transcript.running}
            waitingForUser={transcript.waitingForUser}
            runStartedAt={transcript.runStartedAt}
            onDecisionAnswer={transcript.answerDecision}
            onConfirmAnswer={transcript.answerConfirm}
          />
          <Composer
            running={transcript.running}
            locked={transcript.confirmPending}
            seed={jump.seed}
            history={history}
            onSend={transcript.send}
            onStop={transcript.stop}
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
