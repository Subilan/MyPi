import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "sidecar", "src", "index.ts");
const outDir = path.join(root, "src-tauri", "binaries");
const binaryName = "agent-runbook-agent";

const BUN_TARGETS = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-musl": "bun-linux-arm64-musl",
  "x86_64-unknown-linux-musl": "bun-linux-x64-musl",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
};

function parseArgs(argv) {
  const options = { all: false, target: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") options.all = true;
    else if (arg === "--target") options.target = argv[(index += 1)];
    else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function hostTriple() {
  const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = output.split("\n").find((entry) => entry.startsWith("host:"));
  if (!line) throw new Error("cannot determine host triple from `rustc -vV`");
  return line.slice("host:".length).trim();
}

function outputPath(triple) {
  const suffix = triple.includes("windows") ? ".exe" : "";
  return path.join(outDir, `${binaryName}-${triple}${suffix}`);
}

function build(triple) {
  const bunTarget = BUN_TARGETS[triple];
  if (!bunTarget) {
    throw new Error(
      `no bun target mapped for ${triple}; known triples: ${Object.keys(BUN_TARGETS).join(", ")}`,
    );
  }

  const outfile = outputPath(triple);
  mkdirSync(outDir, { recursive: true });
  process.stdout.write(`sidecar: building ${triple} -> ${path.relative(root, outfile)}\n`);

  execFileSync(
    "bun",
    [
      "build",
      entry,
      "--compile",
      `--target=${bunTarget}`,
      `--outfile=${outfile}`,
    ],
    { cwd: root, stdio: "inherit" },
  );

  if (!existsSync(outfile)) throw new Error(`bun did not produce ${outfile}`);
}

const options = parseArgs(process.argv.slice(2));
const triples = options.all ? Object.keys(BUN_TARGETS) : [options.target ?? hostTriple()];
const failures = [];

for (const triple of triples) {
  try {
    build(triple);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ triple, message });
    const hint = message.includes("Unsupported compile target")
      ? " (this target needs a newer bun; run `bun upgrade`)"
      : "";
    process.stderr.write(`sidecar: failed for ${triple}: ${message}${hint}\n`);
  }
}

if (failures.length > 0) {
  process.exitCode = 1;
  process.stderr.write(`sidecar: ${failures.length}/${triples.length} target(s) failed\n`);
}
