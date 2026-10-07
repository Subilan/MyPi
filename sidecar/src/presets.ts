import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPresetSummary } from "../../shared/protocol.ts";

export interface UiPreset {
  name: string;
  label: string;
  description: string;
  author: string;
  license: string;
  version: string;
  css: string;
}

const PRESETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "presets");

const META_FIELDS = ["name", "label", "description", "author", "license", "version"] as const;

type MetaField = (typeof META_FIELDS)[number];

function parseMeta(file: string, text: string): Record<MetaField, string> {
  const block = text.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!block) {
    throw new Error(`preset "${file}": missing the leading /** metadata comment`);
  }

  const meta: Partial<Record<MetaField, string>> = {};
  for (const rawLine of block[1].split("\n")) {
    const line = rawLine.replace(/^\s*\*?\s?/, "").trim();
    if (!line) continue;
    const at = line.indexOf(":");
    if (at === -1) {
      throw new Error(`preset "${file}": metadata line is not "key: value": ${line}`);
    }
    const key = line.slice(0, at).trim();
    if (!(META_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`preset "${file}": unknown metadata field "${key}"`);
    }
    meta[key as MetaField] = line.slice(at + 1).trim();
  }

  for (const field of META_FIELDS) {
    if (!meta[field]) {
      throw new Error(`preset "${file}": metadata is missing "${field}"`);
    }
  }
  return meta as Record<MetaField, string>;
}

function loadPresets(): UiPreset[] {
  if (!existsSync(PRESETS_DIR)) {
    throw new Error(`presets directory not found: ${PRESETS_DIR} (run \`npm run sidecar:build\`)`);
  }
  return readdirSync(PRESETS_DIR)
    .filter((file) => file.endsWith(".css"))
    .sort()
    .map((file) => {
      const text = readFileSync(path.join(PRESETS_DIR, file), "utf8");
      const meta = parseMeta(file, text);
      const stem = file.slice(0, -".css".length);
      if (meta.name !== stem) {
        throw new Error(`preset "${file}": metadata name "${meta.name}" must match the file name`);
      }
      return { ...meta, css: text };
    });
}

export const UI_PRESETS: readonly UiPreset[] = loadPresets();

export function findPreset(name: string): UiPreset | null {
  const value = name.trim().toLowerCase();
  if (!value) return null;
  const exact = UI_PRESETS.find((preset) => preset.name === value);
  if (exact) return exact;
  const matches = UI_PRESETS.filter((preset) => preset.name.startsWith(value));
  return matches.length === 1 ? matches[0] : null;
}

export function presetSummaries(): AgentPresetSummary[] {
  return UI_PRESETS.map(({ name, label, description }) => ({ name, label, description }));
}
