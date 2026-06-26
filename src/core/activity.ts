import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ratesFor, costOf } from "./pricing";
import type { TokenCounts } from "./types";

/**
 * Step 8 — the live activity ticker.
 *
 * Turns the events Claude Code is writing to its session log, right now, into a
 * short human sentence the user can watch ("Writing code", "Running tests",
 * "Finalizing GitHub push") plus a running, *measured* savings line whenever a
 * turn runs on a cheaper model than Opus ("Ran on Sonnet — saved $0.04 vs
 * Opus"). Pure and deterministic: it only describes what already happened, and
 * every dollar is computed from real token counts. No model call, no network.
 */

export type ActivityKind =
  | "read" | "write" | "edit" | "bash" | "search" | "task"
  | "web" | "mcp" | "think" | "git" | "test" | "build" | "model" | "done" | "work";

export interface ActivityEvent {
  ts: number;            // ms epoch (or sequence index for demos)
  kind: ActivityKind;
  label: string;         // the human sentence
  detail?: string;       // optional secondary text
  savedUSD?: number;     // measured $ saved on this turn (model tiering)
}

const only = (c: Partial<TokenCounts>): TokenCounts => ({
  input: c.input ?? 0, output: c.output ?? 0, cacheWrite: c.cacheWrite ?? 0, cacheRead: c.cacheRead ?? 0,
});

/** Friendly verb for a tool name. */
function labelForTool(name: string, input: any): { kind: ActivityKind; label: string; detail?: string } {
  const n = String(name || "").toLowerCase();
  if (n.startsWith("mcp__")) {
    const server = name.slice(5).split("__")[0];
    return { kind: "mcp", label: `Using ${server}`, detail: undefined };
  }
  if (n === "read") return { kind: "read", label: "Reading files" };
  if (n === "write") return { kind: "write", label: "Writing code" };
  if (n === "edit" || n === "multiedit") return { kind: "edit", label: "Editing code" };
  if (n === "grep" || n === "glob") return { kind: "search", label: "Searching the codebase" };
  if (n === "task") return { kind: "task", label: "Delegating to a subagent" };
  if (n === "websearch") return { kind: "web", label: "Searching the web" };
  if (n === "webfetch") return { kind: "web", label: "Reading a web page" };
  if (n === "todowrite" || n === "taskcreate" || n === "taskupdate") return { kind: "work", label: "Planning the work" };
  if (n === "bash") {
    const cmd = String(input?.command ?? "").toLowerCase();
    if (/\bgit\s+push\b/.test(cmd)) return { kind: "git", label: "Finalizing GitHub push" };
    if (/\bgit\s+commit\b/.test(cmd)) return { kind: "git", label: "Committing changes" };
    if (/\bgit\s+(add|status|diff)\b/.test(cmd)) return { kind: "git", label: "Staging changes" };
    if (/\b(jest|pytest|vitest|mocha|go test|cargo test)\b/.test(cmd) || /\bnpm\s+(run\s+)?test\b/.test(cmd))
      return { kind: "test", label: "Running tests" };
    if (/\b(tsc|webpack|vite build|next build|make|cargo build|go build)\b/.test(cmd) || /\bnpm\s+run\s+build\b/.test(cmd))
      return { kind: "build", label: "Building the project" };
    if (/\b(npm|pnpm|yarn)\s+(install|i|add)\b/.test(cmd) || /\bpip\s+install\b/.test(cmd))
      return { kind: "build", label: "Installing packages" };
    if (/\b(ls|cat|grep|find|rg|head|tail)\b/.test(cmd)) return { kind: "search", label: "Inspecting files" };
    return { kind: "bash", label: "Running a command" };
  }
  return { kind: "work", label: "Working" };
}

/** Measured $ this turn saved by NOT running on Opus, from its real tokens. */
export function modelSaving(model: string, counts: TokenCounts): number {
  const m = String(model || "").toLowerCase();
  if (!m || m.includes("opus")) return 0;       // already top-tier: no tiering saving
  const onOpus = costOf(counts, "claude-opus");
  const actual = costOf(counts, model);
  const saved = onOpus - actual;
  return saved > 0 ? saved : 0;
}

const shortModel = (m: string): string => {
  const s = String(m || "").toLowerCase();
  if (s.includes("haiku")) return "Haiku";
  if (s.includes("sonnet")) return "Sonnet";
  if (s.includes("opus")) return "Opus";
  return m || "model";
};

/** Map one parsed JSONL row to zero or more activity events. */
export function eventsFromRow(row: any): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const tsRaw = row?.timestamp ?? row?.message?.timestamp;
  const ts = tsRaw ? Date.parse(tsRaw) || Date.now() : Date.now();

  // tool actions
  const content = row?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type !== "tool_use") continue;
      const { kind, label, detail } = labelForTool(block?.name, block?.input);
      out.push({ ts, kind, label, detail });
    }
  }

  // model-tiering saving for this turn
  const usage = row?.message?.usage ?? row?.usage;
  const model = row?.message?.model ?? row?.model;
  if (usage && model) {
    const counts = only({
      input: usage.input_tokens, output: usage.output_tokens,
      cacheWrite: usage.cache_creation_input_tokens, cacheRead: usage.cache_read_input_tokens,
    });
    const saved = modelSaving(model, counts);
    if (saved > 0.0001) {
      out.push({
        ts, kind: "model",
        label: `Ran on ${shortModel(model)} — cheaper than Opus`,
        detail: "model tiering",
        savedUSD: saved,
      });
    }
  }
  return out;
}

export interface TailResult { events: ActivityEvent[]; nextByte: number; }

/** Read bytes appended to a JSONL since `fromByte` and map them to events. */
export function tail(file: string, fromByte = 0): TailResult {
  try {
    const size = statSync(file).size;
    if (size <= fromByte) return { events: [], nextByte: size };
    const buf = readFileSync(file);
    const slice = buf.subarray(Math.max(0, fromByte), size).toString("utf8");
    const events: ActivityEvent[] = [];
    for (const line of slice.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let row: any;
      try { row = JSON.parse(t); } catch { continue; }
      for (const e of eventsFromRow(row)) events.push(e);
    }
    return { events, nextByte: size };
  } catch {
    return { events: [], nextByte: fromByte };
  }
}

/** Newest .jsonl under a directory tree (the session being written right now). */
export function activeSessionFile(dir?: string): string | undefined {
  if (!dir) return undefined;
  let best: { file: string; mtime: number } | undefined;
  const walk = (d: string, depth: number) => {
    if (depth > 4) return;
    let names: string[];
    try { names = readdirSync(d); } catch { return; }
    for (const name of names) {
      const full = join(d, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (name.endsWith(".jsonl")) {
        const mt = st.mtimeMs;
        if (!best || mt > best.mtime) best = { file: full, mtime: mt };
      }
    }
  };
  walk(dir, 0);
  return best?.file;
}

/** A scripted sequence for demos/preview — what a real task looks like. */
export function demoActivity(): ActivityEvent[] {
  const seq: Array<[ActivityKind, string, number?]> = [
    ["work", "Planning the work"],
    ["read", "Reading files"],
    ["search", "Searching the codebase"],
    ["write", "Writing code"],
    ["model", "Ran on Sonnet — cheaper than Opus", 0.04],
    ["edit", "Editing code"],
    ["build", "Building the project"],
    ["test", "Running tests"],
    ["model", "Ran on Haiku — cheaper than Opus", 0.02],
    ["edit", "Fixing a failing test"],
    ["test", "Running tests"],
    ["git", "Committing changes"],
    ["git", "Finalizing GitHub push"],
    ["done", "Done — task complete"],
  ];
  return seq.map(([kind, label, saved], i) => ({
    ts: i, kind, label, savedUSD: saved, detail: kind === "model" ? "model tiering" : undefined,
  }));
}
