import { useCallback, useRef, useState, type RefObject } from "react";
import { nowMs } from "@/lib/time";

export interface RunClock {
  running: boolean;
  runStartedAt: number | null;
  waitingForUser: boolean;
  runningRef: RefObject<boolean>;
  start(): void;
  stop(): void;
  setRunning(next: boolean): void;
  beginWaiting(): void;
  endWaiting(): void;
  clearWaiting(): void;
}

export function useRunClock(): RunClock {
  const [running, setRunningState] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [waitingForUser, setWaitingForUser] = useState(false);
  const runningRef = useRef(false);
  const runBaseRef = useRef<number | null>(null);
  const pausedMsRef = useRef(0);
  const waitingStartedAtRef = useRef<number | null>(null);

  const setRunning = useCallback((next: boolean) => {
    runningRef.current = next;
    setRunningState(next);
  }, []);

  const beginWaiting = useCallback(() => {
    if (waitingStartedAtRef.current !== null) return;
    waitingStartedAtRef.current = nowMs();
    setWaitingForUser(true);
  }, []);

  const endWaiting = useCallback(() => {
    const startedAt = waitingStartedAtRef.current;
    if (startedAt === null) return;
    waitingStartedAtRef.current = null;
    pausedMsRef.current += nowMs() - startedAt;
    const base = runBaseRef.current;
    if (base !== null) setRunStartedAt(base + pausedMsRef.current);
    setWaitingForUser(false);
  }, []);

  const clearWaiting = useCallback(() => {
    waitingStartedAtRef.current = null;
    pausedMsRef.current = 0;
    runBaseRef.current = null;
    setWaitingForUser(false);
  }, []);

  const start = useCallback(() => {
    const now = nowMs();
    setRunning(true);
    runBaseRef.current = now;
    pausedMsRef.current = 0;
    waitingStartedAtRef.current = null;
    setRunStartedAt(now);
    setWaitingForUser(false);
  }, [setRunning]);

  const stop = useCallback(() => {
    setRunning(false);
    setRunStartedAt(null);
    clearWaiting();
  }, [clearWaiting, setRunning]);

  return {
    running,
    runStartedAt,
    waitingForUser,
    runningRef,
    start,
    stop,
    setRunning,
    beginWaiting,
    endWaiting,
    clearWaiting,
  };
}
