import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  UsageSummary, ModelUsage, DayUsage, SessionUsage, FileReadCount, TokenCounts,
} from "./types";
import { costOf } from "./pricing";
import { readContextConfig } from "./context";

/**
 * Step 1 + 2b — Obol's eyes.
 * Locates Claude Code session logs (the same local JSONL files the ecosystem
 * reads), parses token usage, and rolls it up by model, by day, AND by session.
 * The per-session rollup is what surfaces findings the aggregate hides: one
 * runaway session, a bloated cached prefix, the same file re-read 11x.
 * No network, no keys, no model call — pure local read.
 */

/** Candidate locations for Claude Code's data dir, in priority order. */
function candidateRoots(): string[] {
  const roots: string[] = [];
  if (process.env.CLAUDE_CONFIG_DIR) roots.push(process.env.CLAUDE_CONFIG_DIR);
  const home = homedir();
  roots.push(join(home, ".claude"));
  roots.push(join(home, ".config", "claude"));
  return roots;
}

/** Find the first existing `projects` directory among the candidate roots. */
function findProjectsDir(): { dir: string | null; searched: string[] } {
  const searched: string[] = [];
  for (const root of candidateRoots()) {
    const projects = join(root, "projects");
    searched.push(projects);
    if (existsSync(projects) && statSync(projects).isDirectory()) {
      return { dir: projects, searched };
    }
  }
  return { dir: null, searched };
}

/** Recursively collect every .jsonl file under a directory. */
function findJsonl(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...findJsonl(full));
    else if (name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

const empty = (): TokenCounts => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

/** Mutable accumulator while parsing a single session file. */
interface SessionAcc {
  id: string;
  file: string;
  counts: TokenCounts;
  turns: number;
  maxCachePrefix: number;            // largest cached prefix on any one turn
  modelCost: Map<string, number>;    // dominant-model pick
  reads: Map<string, number>;        // file_path -> times read
  firstDate?: string;
}

/** Pull file_path values from any Read tool_use blocks in an assistant message. */
function collectReads(row: any, reads: Map<string, number>): void {
  const content = row?.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type !== "tool_use") continue;
    const name = String(block?.name ?? "").toLowerCase();
    if (name !== "read") continue;
    const path = block?.input?.file_path ?? block?.input?.path;
    if (typeof path === "string" && path) {
      reads.set(path, (reads.get(path) ?? 0) + 1);
    }
  }
}

/**
 * Pull MCP server names from invoked tool_use blocks. Claude Code names MCP
 * tools `mcp__<server>__<tool>`; the segment before the first `__` after the
 * `mcp__` prefix is the server. Cross-referenced later against the *configured*
 * servers to find ones that ride the cached prefix but are never actually used.
 */
function collectInvokedServers(row: any, invoked: Set<string>): void {
  const content = row?.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block?.type !== "tool_use") continue;
    const name = String(block?.name ?? "");
    if (!name.startsWith("mcp__")) continue;
    const server = name.slice(5).split("__")[0];
    if (server) invoked.add(server);
  }
}

/** Parse one JSONL session file into a SessionAcc; null if it carried no usage. */
function parseSession(file: string, seen: Set<string>, invoked: Set<string>): SessionAcc | null {
  const acc: SessionAcc = {
    id: basename(file).replace(/\.jsonl$/, ""),
    file,
    counts: empty(),
    turns: 0,
    maxCachePrefix: 0,
    modelCost: new Map(),
    reads: new Map(),
  };

  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row: any;
    try { row = JSON.parse(line); } catch { continue; }

    collectReads(row, acc.reads);
    collectInvokedServers(row, invoked);

    const usage = row?.message?.usage ?? row?.usage;
    if (!usage) continue;

    const model: string = row?.message?.model ?? row?.model ?? "unknown";

    // dedup: Claude Code can repeat a logical message across lines
    const id = row?.message?.id ?? row?.uuid ?? "";
    const reqId = row?.requestId ?? row?.request_id ?? "";
    const key = id || reqId ? `${id}:${reqId}` : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    const c: TokenCounts = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
    };

    acc.counts.input += c.input; acc.counts.output += c.output;
    acc.counts.cacheWrite += c.cacheWrite; acc.counts.cacheRead += c.cacheRead;
    acc.turns += 1;

    // cached prefix carried on this turn ≈ stable system + CLAUDE.md + tool defs
    const prefix = c.cacheRead + c.cacheWrite;
    if (prefix > acc.maxCachePrefix) acc.maxCachePrefix = prefix;

    acc.modelCost.set(model, (acc.modelCost.get(model) ?? 0) + costOf(c, model));

    const ts: string = row?.timestamp ?? "";
    const date = ts.slice(0, 10);
    if (date && !acc.firstDate) acc.firstDate = date;
  }

  return acc.turns > 0 ? acc : null;
}

/** Resolve the dominant (most expensive) model used in a session. */
function dominantModel(modelCost: Map<string, number>): string {
  let best = "unknown", bestCost = -1;
  for (const [m, cost] of modelCost) {
    if (cost > bestCost) { best = m; bestCost = cost; }
  }
  return best;
}

/** Read all Claude Code usage and return a single summary. */
export function readUsage(overrideDir?: string): UsageSummary {
  let projects = overrideDir ?? null;
  let searched: string[] = [];
  if (!projects) {
    const found = findProjectsDir();
    projects = found.dir;
    searched = found.searched;
  } else {
    searched = [projects];
  }

  const base: UsageSummary = {
    found: false, searchedPaths: searched, sessions: 0,
    input: 0, output: 0, cacheWrite: 0, cacheRead: 0,
    totalTokens: 0, totalCostUSD: 0, byModel: [], byDay: [], bySession: [],
  };
  if (!projects || !existsSync(projects)) return base;

  const files = findJsonl(projects);
  if (files.length === 0) return { ...base, source: projects };

  const seen = new Set<string>();
  const invokedServers = new Set<string>();
  const perModel = new Map<string, TokenCounts>();
  const perDay = new Map<string, TokenCounts>();
  const perDayCost = new Map<string, number>();
  const bySession: SessionUsage[] = [];

  for (const f of files) {
    const acc = parseSession(f, seen, invokedServers);
    if (!acc) continue;

    const model = dominantModel(acc.modelCost);
    const cost = [...acc.modelCost.values()].reduce((s, v) => s + v, 0);

    // by-model aggregate
    const m = perModel.get(model) ?? empty();
    m.input += acc.counts.input; m.output += acc.counts.output;
    m.cacheWrite += acc.counts.cacheWrite; m.cacheRead += acc.counts.cacheRead;
    perModel.set(model, m);

    // by-day aggregate
    const date = acc.firstDate ?? "unknown";
    const dm = perDay.get(date) ?? empty();
    dm.input += acc.counts.input; dm.output += acc.counts.output;
    dm.cacheWrite += acc.counts.cacheWrite; dm.cacheRead += acc.counts.cacheRead;
    perDay.set(date, dm);
    perDayCost.set(date, (perDayCost.get(date) ?? 0) + cost);

    const repeatedReads: FileReadCount[] = [...acc.reads.entries()]
      .filter(([, n]) => n > 1)
      .map(([path, reads]) => ({ path, reads }))
      .sort((a, b) => b.reads - a.reads);

    bySession.push({
      id: acc.id, file: acc.file, model, date: acc.firstDate,
      input: acc.counts.input, output: acc.counts.output,
      cacheWrite: acc.counts.cacheWrite, cacheRead: acc.counts.cacheRead,
      turns: acc.turns, costUSD: cost,
      avgCachePrefix: acc.maxCachePrefix,
      repeatedReads,
    });
  }

  bySession.sort((a, b) => b.costUSD - a.costUSD);

  const byModel: ModelUsage[] = [...perModel.entries()].map(([model, c]) => ({
    model, ...c, costUSD: costOf(c, model),
  })).sort((a, b) => b.costUSD - a.costUSD);

  const byDay: DayUsage[] = [...perDay.entries()].map(([date, c]) => ({
    date,
    tokens: c.input + c.output + c.cacheWrite + c.cacheRead,
    costUSD: perDayCost.get(date) ?? 0,
  })).sort((a, b) => a.date.localeCompare(b.date));

  const totals = byModel.reduce((acc, m) => {
    acc.input += m.input; acc.output += m.output;
    acc.cacheWrite += m.cacheWrite; acc.cacheRead += m.cacheRead;
    acc.totalCostUSD += m.costUSD;
    return acc;
  }, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalCostUSD: 0 });

  const dates = byDay.map((d) => d.date).filter((d) => d !== "unknown");

  return {
    found: true,
    source: projects,
    searchedPaths: searched,
    sessions: bySession.length,
    input: totals.input,
    output: totals.output,
    cacheWrite: totals.cacheWrite,
    cacheRead: totals.cacheRead,
    totalTokens: totals.input + totals.output + totals.cacheWrite + totals.cacheRead,
    totalCostUSD: totals.totalCostUSD,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    byModel,
    byDay,
    bySession,
    mcpServers: readContextConfig().mcpServers,
    invokedMcpServers: [...invokedServers].sort(),
  };
}
