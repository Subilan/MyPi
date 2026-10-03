import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpIcon, CircleStopIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { agentClient, isTauriRuntime, type AppInfo } from "@/lib/agent/client";
import type { AgentRuntimeInfo } from "@shared/protocol";

type Phase = "idle" | "streaming";

export default function App() {
  const client = agentClient();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [runtime, setRuntime] = useState<AgentRuntimeInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const phaseRef = useRef<Phase>("idle");

  const setPhaseSafe = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setBridgeError("当前不是 Tauri 运行环境，请用 npm run tauri dev 启动。");
      return;
    }

    const off = client.onRecord((record) => {
      if (record.type === "event") {
        if (record.name === "text_delta") {
          const data = record.data as { delta?: string };
          setReply((current) => current + (data.delta ?? ""));
        }
        if (record.name === "agent_end") {
          setPhaseSafe("idle");
        }
        return;
      }
      if (record.type === "log") {
        if (record.level === "error") toast.error(record.message);
        return;
      }
      if (record.type === "closed") {
        setPhaseSafe("idle");
        setBridgeError(record.reason);
      }
    });

    void (async () => {
      try {
        await client.connect();
        await client.waitUntilConnected();
        const [info, hello] = await Promise.all([
          invoke<AppInfo>("app_info"),
          client.hello("world"),
        ]);
        setAppInfo(info);
        setRuntime(hello.runtime);
        toast.success(hello.greeting);
      } catch (error) {
        setBridgeError(error instanceof Error ? error.message : String(error));
      }
    })();

    return off;
  }, [client, setPhaseSafe]);

  const submit = useCallback(async () => {
    const text = prompt.trim();
    if (!text || phaseRef.current === "streaming") return;
    setPrompt("");
    setReply("");
    setPhaseSafe("streaming");
    try {
      await client.prompt(text);
    } catch (error) {
      setPhaseSafe("idle");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [client, prompt, setPhaseSafe]);

  const abort = useCallback(async () => {
    try {
      await client.abort();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPhaseSafe("idle");
    }
  }, [client, setPhaseSafe]);

  return (
    <main className="flex min-h-svh flex-col items-center gap-6 bg-background p-8">
      <header className="flex w-full max-w-3xl flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">agent-runbook</h1>
          <Badge variant={runtime?.demo ? "secondary" : "default"}>
            {runtime?.demo ? "demo provider" : "live provider"}
          </Badge>
          <Badge variant="outline">
            {phase === "streaming" ? "streaming" : "idle"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Tauri 前端 + Rust 宿主 + pi-agent-core sidecar 三层已经打通。
        </p>
      </header>

      {bridgeError ? (
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <CardTitle>桥接未就绪</CardTitle>
            <CardDescription>{bridgeError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>运行环境</CardTitle>
          <CardDescription>
            Rust 侧来自 Tauri 命令，agent 侧来自 sidecar 的 hello 记录。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Row label="app" value={appInfo ? `${appInfo.name} ${appInfo.version}` : "…"} />
          <Row label="tauri" value={appInfo?.tauri ?? "…"} />
          <Row
            label="host"
            value={appInfo ? `${appInfo.os}/${appInfo.arch}` : "…"}
          />
          <Row label="core" value={runtime?.coreVersion ?? "…"} />
          <Row label="model" value={runtime?.model ?? "…"} />
          <Row
            label="sidecar"
            value={runtime ? `${runtime.runtime} · ${runtime.platform} · protocol v${runtime.protocol}` : "…"}
          />
        </CardContent>
      </Card>

      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Hello world</CardTitle>
          <CardDescription>
            prompt 会被 sidecar 里的 Agent 处理，文本增量通过 stdout 流回前端。
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-24 text-sm">
          {reply ? (
            <p className="whitespace-pre-wrap">
              {reply}
              {phase === "streaming" ? (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-text-bottom" />
              ) : null}
            </p>
          ) : (
            <p className="text-muted-foreground">还没有回复。</p>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          <Input
            value={prompt}
            placeholder="说点什么，比如 hello world"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
          {phase === "streaming" ? (
            <Button variant="outline" onClick={() => void abort()}>
              <CircleStopIcon data-icon="inline-start" />
              停止
            </Button>
          ) : (
            <Button onClick={() => void submit()} disabled={!prompt.trim()}>
              <ArrowUpIcon data-icon="inline-start" />
              发送
            </Button>
          )}
        </CardFooter>
      </Card>

      {runtime?.demo ? (
        <p className="w-full max-w-3xl text-xs text-muted-foreground">
          当前用的是 pi-ai 内置的 faux provider，不需要凭证，回复是脚本化的。
          接入真实模型的位置在 sidecar/src/agent-host.ts。
        </p>
      ) : null}

      <Toaster />
      {appInfo ? null : <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono text-xs break-all">{value}</span>
    </div>
  );
}
