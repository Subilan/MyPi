export interface InsertPathsResult {
  text: string;
  caret: number;
}

export function insertPaths(
  current: string,
  start: number,
  end: number,
  paths: readonly string[],
): InsertPathsResult | null {
  const list = paths.filter((entry) => entry.length > 0);
  if (list.length === 0) return null;

  const from = clampIndex(start, current.length);
  const to = Math.max(from, clampIndex(end, current.length));
  const before = current.slice(0, from);
  const after = current.slice(to);
  const spacer = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const insert = `${spacer}${list.join(" ")} `;

  return { text: before + insert + after, caret: from + insert.length };
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length;
  return Math.min(Math.max(0, Math.floor(value)), length);
}
