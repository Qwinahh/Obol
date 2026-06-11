import type {
  UsageSummary, ModelUsage, DayUsage, SessionUsage, TokenCounts,
} from "./types";
import { costOf } from "./pricing";

/**
 * Demo mode — a synthetic-but-believable power-user profile.
 *
 * Everything Obol shows on real logs, it shows here: a leaky cache, an
 * Opus-heavy mix, verbose output, one runaway session, the same files re-read,
 * and unused MCP servers riding the cached prefix. The numbers are internally
 * consistent (costs are computed from the real pricing table), so the receipt,
 * diagnosis, apply plan, fingerprint, recommender and guard all light up.
 *
 * It exists so you can see the full UI in one command — `obol --demo` — with no
 * logs, no setup, and (like everything else here) zero tokens.
 */

const OPUS = "claude-opus-4-6";
const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5";

const counts = (
  input: number, output: number, cacheWrite: number, cacheRead: number,
): TokenCounts => ({ input, output, cacheWrite, cacheRead });

function model(name: string, t: TokenCounts): ModelUsage {
  return { model: name, ...t, costUSD: costOf(t, name) };
}

/** Twoish weeks of daily spend, with a clear peak the day the big session ran. */
const DAYS: [string, number][] = [
  ["2026-05-27", 3.10], ["2026-05-28", 5.40], ["2026-05-29", 4.20],
  ["2026-05-30", 7.80], ["2026-05-31", 2.10], ["2026-06-01", 1.20],
  ["2026-06-02", 9.30], ["2026-06-03", 12.60], ["2026-06-04", 6.40],
  ["2026-06-05", 41.90], ["2026-06-06", 8.70], ["2026-06-07", 3.30],
  ["2026-06-08", 5.10], ["2026-06-09", 4.05],
];

interface DemoSession {
  id: string; turns: number; cost: number; prefix: number;
  reads: [string, number][]; model: string; date: string;
}

const SESSIONS: DemoSession[] = [
  { id: "a1b2c3d4e5f6", turns: 142, cost: 39.20, prefix: 34000,
    reads: [["~/proj/src/core/usage.ts", 7], ["~/proj/README.md", 4]],
    model: OPUS, date: "2026-06-05" },
  { id: "e5f6a7b8c9d0", turns: 88, cost: 21.50, prefix: 31000,
    reads: [["~/proj/package.json", 3]], model: OPUS, date: "2026-06-03" },
  { id: "c9d0e1f2a3b4", turns: 60, cost: 14.30, prefix: 28500,
    reads: [], model: SONNET, date: "2026-06-02" },
  { id: "3a4b5c6d7e8f", turns: 45, cost: 11.10, prefix: 26000,
    reads: [["~/proj/tsconfig.json", 3]], model: OPUS, date: "2026-06-06" },
  { id: "7e8f9a0b1c2d", turns: 22, cost: 6.40, prefix: 22000,
    reads: [], model: SONNET, date: "2026-05-30" },
  { id: "1c2d3e4f5a6b", turns: 12, cost: 4.05, prefix: 9000,
    reads: [], model: HAIKU, date: "2026-06-09" },
];

function session(s: DemoSession): SessionUsage {
  // Plausible per-session token counts (not load-bearing for diagnosis, which
  // reads cost/turns/prefix/reads — included for completeness and honesty).
  const t = counts(
    Math.round(s.prefix * 0.25 * (s.turns / 10)),
    Math.round(s.prefix * 0.10 * (s.turns / 10)),
    Math.round(s.prefix * 0.5),
    Math.round(s.prefix * s.turns * 0.6),
  );
  return {
    id: s.id,
    file: `demo://projects/your-app/${s.id}.jsonl`,
    model: s.model,
    date: s.date,
    turns: s.turns,
    costUSD: s.cost,
    avgCachePrefix: s.prefix,
    repeatedReads: s.reads.map(([path, reads]) => ({ path, reads })),
    ...t,
  };
}

/** A complete, valid UsageSummary that exercises every surface. */
export function demoUsage(): UsageSummary {
  const byModel: ModelUsage[] = [
    model(OPUS, counts(6_000_000, 1_400_000, 1_500_000, 7_000_000)),
    model(SONNET, counts(2_000_000, 600_000, 400_000, 2_000_000)),
    model(HAIKU, counts(600_000, 250_000, 80_000, 300_000)),
  ];

  const totals = byModel.reduce<TokenCounts>(
    (a, m) => ({
      input: a.input + m.input,
      output: a.output + m.output,
      cacheWrite: a.cacheWrite + m.cacheWrite,
      cacheRead: a.cacheRead + m.cacheRead,
    }),
    counts(0, 0, 0, 0),
  );

  const byDay: DayUsage[] = DAYS.map(([date, costUSD]) => ({
    date,
    costUSD,
    tokens: Math.round(costUSD * 90_000), // rough tokens-per-dollar back-of-envelope
  }));

  const bySession = SESSIONS.map(session).sort((a, b) => b.costUSD - a.costUSD);

  const totalCostUSD = byModel.reduce((s, m) => s + m.costUSD, 0);
  const totalTokens =
    totals.input + totals.output + totals.cacheWrite + totals.cacheRead;

  return {
    found: true,
    source: "demo://synthetic-usage",
    searchedPaths: [],
    sessions: bySession.length,
    ...totals,
    totalTokens,
    totalCostUSD,
    firstDate: DAYS[0][0],
    lastDate: DAYS[DAYS.length - 1][0],
    byModel,
    byDay,
    bySession,
    mcpServers: ["github", "postgres", "puppeteer", "sentry", "linear", "filesystem"],
    invokedMcpServers: ["github", "filesystem"],
  };
}
