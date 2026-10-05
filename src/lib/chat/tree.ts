import type { AgentSessionEntry } from "@shared/protocol";
import type { ChatMessage } from "@/lib/chat/types";

export interface ChatTreeNode {
  entry: AgentSessionEntry;
  parent: string | null;
  children: string[];
}

export interface ChatTree {
  byId: Map<string, ChatTreeNode>;
  head: string | null;
}

export function buildTree(nodes: AgentSessionEntry[], head: string | null): ChatTree {
  const byId = new Map<string, ChatTreeNode>();
  for (const entry of nodes) byId.set(entry.id, { entry, parent: entry.parent, children: [] });
  for (const entry of nodes) {
    const parent = entry.parent ? byId.get(entry.parent) : null;
    if (parent) parent.children.push(entry.id);
  }
  return { byId, head };
}

export function pathTo(tree: ChatTree, id: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(cursor);
    cursor = tree.byId.get(cursor)?.parent ?? null;
  }
  return path.reverse();
}

export function pathEntries(tree: ChatTree, id: string | null): AgentSessionEntry[] {
  if (!id) return [];
  return pathTo(tree, id).flatMap((nodeId) => {
    const node = tree.byId.get(nodeId);
    return node ? [node.entry] : [];
  });
}

export function defaultTarget(tree: ChatTree, id: string): string {
  let cursor = id;
  for (;;) {
    const node = tree.byId.get(cursor);
    if (!node || node.children.length === 0) return cursor;
    cursor = node.children[node.children.length - 1];
  }
}

export function lastEntryId(tree: ChatTree): string | null {
  let last: string | null = null;
  for (const id of tree.byId.keys()) last = id;
  return last;
}

export function isDisplayableEntry(entry: AgentSessionEntry): boolean {
  if (entry.role !== "assistant") return true;
  return entry.text.length > 0 || entry.error !== null;
}

export function projectTree(
  tree: ChatTree,
  isVisible: (entry: AgentSessionEntry) => boolean,
): ChatTree {
  const byId = new Map<string, ChatTreeNode>();
  for (const [id, node] of tree.byId) {
    if (isVisible(node.entry)) byId.set(id, { entry: node.entry, parent: null, children: [] });
  }
  const visibleParent = (start: string | null): string | null => {
    let cursor = start;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (byId.has(cursor)) return cursor;
      seen.add(cursor);
      cursor = tree.byId.get(cursor)?.entry.parent ?? null;
    }
    return null;
  };
  for (const [id, node] of byId) {
    const parentId = visibleParent(node.entry.parent);
    node.parent = parentId;
    if (parentId) byId.get(parentId)?.children.push(id);
  }
  const head = tree.head && byId.has(tree.head) ? tree.head : visibleParent(tree.head);
  return { byId, head };
}

export function entryToMessage(entry: AgentSessionEntry): ChatMessage {
  switch (entry.role) {
    case "user":
      return {
        id: entry.id,
        role: "user",
        text: entry.text,
        createdAt: entry.at,
        startedAt: entry.at,
      };
    case "assistant":
      return {
        id: entry.id,
        role: "assistant",
        text: entry.text,
        createdAt: entry.at,
        startedAt: entry.at,
        streaming: false,
        thinking: false,
        error: entry.error,
      };
    case "tool":
      return {
        id: entry.id,
        role: "tool",
        toolCallId: entry.toolCallId,
        name: entry.name,
        args: entry.args,
        status: entry.isError ? "error" : "ok",
        output: entry.output,
        createdAt: entry.at,
        startedAt: entry.durationMs !== undefined ? entry.at - entry.durationMs : entry.at,
        finishedAt: entry.durationMs !== undefined ? entry.at : null,
        error: entry.isError ? entry.output || "工具执行失败" : null,
      };
    case "error":
      return { id: entry.id, role: "error", text: entry.text, createdAt: entry.at };
    case "notice":
      return {
        id: entry.id,
        role: "notice",
        title: entry.title,
        text: entry.text,
        createdAt: entry.at,
        error: null,
      };
  }
}

export function toSessionMessages(entries: AgentSessionEntry[]): ChatMessage[] {
  return entries
    .filter(
      (entry) => entry.role !== "assistant" || entry.text.length > 0 || entry.error !== null,
    )
    .map(entryToMessage);
}
