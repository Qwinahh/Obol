import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProfileId } from "./profile";

/**
 * Step 5 — local savings history.
 *
 * A tiny, append-only JSON ledger kept ONLY on the user's machine
 * (~/.obol/history.json). It never leaves the device, never spends a token,
 * and is pure deterministic bookkeeping. Two kinds of fact get recorded:
 *
 *   - scan  : a snapshot taken whenever Obol analyses real logs. Carries the
 *             current estimate and the *measured* cache receipt (cumulative
 *             dollars caching has already saved, per the proof engine).
 *   - apply : a discrete event — the user wrote N green fixes. This is the only
 *             genuinely additive number, so "locked-in" savings sum these.
 *
 * The summary is careful about what it adds up:
 *   - measuredSavedUSD is the LATEST receipt (a running cumulative total in the
 *     logs themselves) — taking the max avoids double-counting the same dollars.
 *   - appliedFixes / appliedSaveUSD SUM apply events — each is a distinct action.
 *   - streaks count distinct calendar days Obol was run.
 */

const SCHEMA = 1;
const MAX_ENTRIES = 1000;

export type HistoryKind = "scan" | "apply";

export interface HistoryEntry {
  ts: string;            // ISO timestamp
  date: string;          // YYYY-MM-DD (local)
  kind: HistoryKind;
  profile: ProfileId;
  estSaveUSD: number;    // estimated actionable savings at scan time
  receiptSavedUSD: number; // measured cumulative cache savings (proof receipt)
  appliedGreen: number;  // green fixes written this event (apply only)
  appliedSaveUSD: number;// estimated $ of the fixes written this event
}

export interface HistoryFile {
  schema: number;
  entries: HistoryEntry[];
}

export interface HistoryPoint { date: string; savedUSD: number; }

export interface HistorySummary {
  runs: number;
  firstDate?: string;
  lastDate?: string;
  /** measured cumulative dollars caching has saved (latest receipt, not a sum) */
  measuredSavedUSD: number;
  /** total green fixes the user has applied over all time (summed events) */
  appliedFixes: number;
  /** estimated recurring $ locked in by those applied fixes (summed events) */
  appliedSaveUSD: number;
  /** best current actionable estimate (latest scan) */
  latestEstSaveUSD: number;
  currentStreak: number; // consecutive days up to lastDate
  longestStreak: number;
  /** measured-saved trend, one point per day Obol ran */
  trend: HistoryPoint[];
}

export function historyPath(): string {
  return join(homedir(), ".obol", "history.json");
}

/** Load the ledger. Never throws: a missing/corrupt file reads as empty. */
export function loadHistory(file = historyPath()): HistoryFile {
  try {
    if (!existsSync(file)) return { schema: SCHEMA, entries: [] };
    const raw = JSON.parse(readFileSync(file, "utf8")) as HistoryFile;
    if (!raw || !Array.isArray(raw.entries)) return { schema: SCHEMA, entries: [] };
    return { schema: raw.schema || SCHEMA, entries: raw.entries };
  } catch {
    return { schema: SCHEMA, entries: [] };
  }
}

const todayLocal = (d = new Date()): string => {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

export interface RecordInput {
  kind?: HistoryKind;
  profile: ProfileId;
  estSaveUSD?: number;
  receiptSavedUSD?: number;
  appliedGreen?: number;
  appliedSaveUSD?: number;
}

/**
 * Append one event to the ledger. Best-effort and side-effecting: returns the
 * new summary, or the prior one if the disk write fails (never throws). Demo
 * mode must NOT call this — it uses demoHistory() instead.
 */
export function recordRun(input: RecordInput, file = historyPath()): HistorySummary {
  const now = new Date();
  const entry: HistoryEntry = {
    ts: now.toISOString(),
    date: todayLocal(now),
    kind: input.kind || "scan",
    profile: input.profile,
    estSaveUSD: round(input.estSaveUSD),
    receiptSavedUSD: round(input.receiptSavedUSD),
    appliedGreen: Math.max(0, Math.floor(input.appliedGreen || 0)),
    appliedSaveUSD: round(input.appliedSaveUSD),
  };
  const data = loadHistory(file);
  data.schema = SCHEMA;
  data.entries.push(entry);
  if (data.entries.length > MAX_ENTRIES) data.entries = data.entries.slice(-MAX_ENTRIES);
  try {
    mkdirSync(join(homedir(), ".obol"), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch { /* best-effort: the report still renders without persistence */ }
  return summarize(data);
}

const round = (n?: number): number => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;

/** Pure: collapse the ledger into the numbers a surface displays. */
export function summarize(file: HistoryFile): HistorySummary {
  const e = file.entries.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  if (!e.length) {
    return {
      runs: 0, measuredSavedUSD: 0, appliedFixes: 0, appliedSaveUSD: 0,
      latestEstSaveUSD: 0, currentStreak: 0, longestStreak: 0, trend: [],
    };
  }

  const measuredSavedUSD = e.reduce((m, x) => Math.max(m, x.receiptSavedUSD), 0);
  const appliedFixes = e.reduce((s, x) => s + (x.kind === "apply" ? x.appliedGreen : 0), 0);
  const appliedSaveUSD = round(e.reduce((s, x) => s + (x.kind === "apply" ? x.appliedSaveUSD : 0), 0));
  const latestEstSaveUSD = e[e.length - 1].estSaveUSD;

  // distinct days, sorted
  const days = Array.from(new Set(e.map((x) => x.date))).sort();
  const { current, longest } = streaks(days);

  // trend: best measured receipt seen on each day
  const byDay = new Map<string, number>();
  for (const x of e) byDay.set(x.date, Math.max(byDay.get(x.date) ?? 0, x.receiptSavedUSD));
  const trend: HistoryPoint[] = days.map((d) => ({ date: d, savedUSD: round(byDay.get(d) ?? 0) }));

  return {
    runs: e.length,
    firstDate: days[0],
    lastDate: days[days.length - 1],
    measuredSavedUSD: round(measuredSavedUSD),
    appliedFixes,
    appliedSaveUSD,
    latestEstSaveUSD,
    currentStreak: current,
    longestStreak: longest,
    trend,
  };
}

const DAY = 86400000;
function streaks(days: string[]): { current: number; longest: number } {
  if (!days.length) return { current: 0, longest: 0 };
  const t = days.map((d) => Date.parse(d + "T00:00:00")).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  let longest = 1, run = 1;
  for (let i = 1; i < t.length; i++) {
    const gap = Math.round((t[i] - t[i - 1]) / DAY);
    run = gap === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  // current streak: consecutive days ending at the most recent recorded day
  let current = 1;
  for (let i = t.length - 1; i > 0; i--) {
    const gap = Math.round((t[i] - t[i - 1]) / DAY);
    if (gap === 1) current++; else break;
  }
  return { current, longest };
}

/** Synthetic, in-memory history for demo mode — never touches disk. */
export function demoHistory(): HistorySummary {
  const days: HistoryPoint[] = [];
  const start = new Date();
  start.setDate(start.getDate() - 13);
  let saved = 22;
  for (let i = 0; i < 14; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const z = (n: number) => String(n).padStart(2, "0");
    saved += 4.5 + (i % 3) * 1.7;
    days.push({ date: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`, savedUSD: round(saved) });
  }
  return {
    runs: 18,
    firstDate: days[0].date,
    lastDate: days[days.length - 1].date,
    measuredSavedUSD: days[days.length - 1].savedUSD,
    appliedFixes: 5,
    appliedSaveUSD: 12.4,
    latestEstSaveUSD: 17.3,
    currentStreak: 6,
    longestStreak: 9,
    trend: days,
  };
}
