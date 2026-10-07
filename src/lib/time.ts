import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(duration);
dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

export function nowMs(): number {
  return dayjs().valueOf();
}

export function formatClock(ms: number): string {
  return dayjs(ms).format("HH:mm:ss");
}

export function formatDateTime(ms: number): string {
  return dayjs(ms).format("YYYY-MM-DD HH:mm:ss");
}

export function formatIso(ms: number): string {
  return dayjs(ms).toISOString();
}

export function formatRelative(ms: number): string {
  return dayjs(ms).fromNow();
}

export function formatDuration(ms: number): string {
  const value = dayjs.duration(Math.max(0, Math.floor(ms / 1000)), "seconds");
  const hours = Math.floor(value.asHours());
  if (hours > 0) return `${hours}h${value.minutes()}m${value.seconds()}s`;
  const minutes = Math.floor(value.asMinutes());
  if (minutes > 0) return `${minutes}m${value.seconds()}s`;
  return `${value.seconds()}s`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  return formatDuration(ms);
}
