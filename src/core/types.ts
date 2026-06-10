// Obol core types — the shared vocabulary every surface (CLI, Claude Code plugin,
// VS Code extension) speaks. Kept deliberately small in Step 0; grows with each step.

/** The four places a token can be wasted. Every technique maps to exactly one. */
export type WasteType =
  | "input-reuse"      // A: re-sending the same context (fix: caching / context mgmt)
  | "input-unneeded"   // B: sending more than needed (fix: trimming)
  | "output-verbose"   // C: longer output than needed (fix: output discipline)
  | "wrong-route";     // D: wrong model / no batching (fix: route selection)

/** Which side of the bill a technique affects. Output ~5x the price of input. */
export type SavesSide = "input" | "output" | "both";

/**
 * Can the tool apply this automatically?
 *  - "green": safe to auto-apply (e.g. set max_tokens, strip whitespace)
 *  - "amber": detect + recommend, but a human approves (e.g. trim a system prompt)
 */
export type AutoApply = "green" | "amber";

/** One entry in the technique catalog — the rules engine's atomic unit. */
export interface Technique {
  id: string;
  name: string;
  tier: "A" | "B" | "C" | "D";
  wasteType: WasteType;
  savesSide: SavesSide;
  autoApply: AutoApply;
  /** Plain-language one-liner shown to the user. */
  summary: string;
}

/** A loaded, validated catalog. */
export interface Catalog {
  version: string;
  techniques: Technique[];
}

// ---- Step 1: usage shapes ----

/** Raw token counts pulled from a Claude Code session log. */
export interface TokenCounts {
  input: number;       // uncached input tokens
  output: number;      // generated tokens (~5x the price of input)
  cacheWrite: number;  // cache_creation_input_tokens
  cacheRead: number;   // cache_read_input_tokens
}

/** Per-model rollup with an estimated dollar cost. */
export interface ModelUsage extends TokenCounts {
  model: string;
  costUSD: number;
}

/** Per-day rollup for trend lines. */
export interface DayUsage {
  date: string;        // YYYY-MM-DD
  tokens: number;
  costUSD: number;
}

/** Everything Obol learned from your logs in one object. */
export interface UsageSummary extends TokenCounts {
  found: boolean;
  source?: string;          // which directory the data came from
  searchedPaths: string[];  // where Obol looked (shown when nothing is found)
  sessions: number;
  totalTokens: number;
  totalCostUSD: number;
  firstDate?: string;
  lastDate?: string;
  byModel: ModelUsage[];
  byDay: DayUsage[];
  bySession: SessionUsage[];
  /** MCP servers configured locally — they ride the cached prefix every call. */
  mcpServers?: string[];
  /** MCP servers actually invoked in the logs (server segment of mcp__<server>__<tool>). */
  invokedMcpServers?: string[];
}

// ---- Step 2: diagnosis shapes ----

/** A single diagnosis result. */
export interface Finding {
  techniqueId: string;
  title: string;
  /** win = actionable saving · ok = already efficient · info = note */
  severity: "win" | "ok" | "info";
  confidence: "high" | "med" | "low";
  message: string;
  estSaveUSD: number;
  estSavePct: number;       // share of total spend
  autoApply: "green" | "amber" | "n/a";
  action: string;
}

export interface Diagnosis {
  findings: Finding[];
  totalEstSaveUSD: number;
  totalEstSavePct: number;
  /** true when usage is already efficient and little/nothing is actionable. */
  alreadyEfficient: boolean;
}

// ---- Step 2b: per-session detail ----

/** A file read inside a session, with how many times it was read. */
export interface FileReadCount {
  path: string;
  reads: number;
}

/**
 * One session rolled up on its own. This is where findings hide for users
 * whose aggregate numbers already look efficient: a single runaway session,
 * a bloated stable prefix re-sent every turn, or the same file re-read 11x.
 */
export interface SessionUsage extends TokenCounts {
  id: string;               // session id (file stem)
  file: string;             // source jsonl path
  model: string;            // dominant model in the session
  date?: string;            // first timestamp date
  turns: number;            // assistant messages (billed turns)
  costUSD: number;
  /** avg cached prefix carried on each turn ≈ size of system + CLAUDE.md + tool defs */
  avgCachePrefix: number;
  /** files read more than once, worst first */
  repeatedReads: FileReadCount[];
}
