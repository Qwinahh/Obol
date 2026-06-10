import type { UsageSummary, SessionUsage, Finding, Diagnosis, TokenCounts } from "./types";
import { costOf, ratesFor } from "./pricing";

/**
 * Step 2 + 2b — diagnosis.
 * Runs a UsageSummary against the technique catalog and returns ranked,
 * confidence-tagged findings. Deterministic: no model call.
 *
 * Two passes:
 *  - aggregate detectors (caching, model tiering, output discipline)
 *  - per-session detectors — where findings hide for users whose totals already
 *    look efficient: one runaway session, a bloated cached prefix re-sent every
 *    turn, the same file re-read many times.
 *
 * Honesty rules baked in:
 *  - When a lever is already handled well, report "ok" with $0 — never invent
 *    a saving.
 *  - Every saving is an *estimate* with a confidence tag. Step 3 (Proof Engine)
 *    measures it for real; Step 4 (Quality Guard) proves answers don't degrade.
 *  - Estimates are deliberately conservative.
 */

const only = (counts: Partial<TokenCounts>): TokenCounts => ({
  input: counts.input ?? 0, output: counts.output ?? 0,
  cacheWrite: counts.cacheWrite ?? 0, cacheRead: counts.cacheRead ?? 0,
});

const fmtTok = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;

export function diagnose(u: UsageSummary): Diagnosis {
  const findings: Finding[] = [];
  const total = u.totalCostUSD;

  if (!u.found || total <= 0) {
    return { findings: [], totalEstSaveUSD: 0, totalEstSavePct: 0, alreadyEfficient: false };
  }

  // --- cost broken down by component (summed across models, model-correct rates) ---
  let inputCost = 0, outputCost = 0, cacheReadCost = 0, cacheWriteCost = 0;
  let opusCost = 0;
  for (const m of u.byModel) {
    inputCost      += costOf(only({ input: m.input }), m.model);
    outputCost     += costOf(only({ output: m.output }), m.model);
    cacheReadCost  += costOf(only({ cacheRead: m.cacheRead }), m.model);
    cacheWriteCost += costOf(only({ cacheWrite: m.cacheWrite }), m.model);
    if (m.model.toLowerCase().includes("opus")) opusCost += m.costUSD;
  }

  const pctOf = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  // ================= aggregate detectors =================

  // ---- A1: cache efficiency (input side) ----
  const inputSide = u.input + u.cacheRead;
  if (inputSide > 0) {
    const readShare = u.cacheRead / inputSide;
    if (readShare >= 0.8) {
      findings.push({
        techniqueId: "A1", title: "Prompt caching", severity: "ok", confidence: "high",
        message: `Caching is working well — ${Math.round(readShare * 100)}% of your input is cheap cached reads.`,
        estSaveUSD: 0, estSavePct: 0, autoApply: "n/a",
        action: "No action — you're already getting the ~90% cache discount on reused context.",
      });
    } else {
      const reusableFraction = 0.5;
      const save = inputCost * reusableFraction * 0.9;
      findings.push({
        techniqueId: "A1", title: "Prompt caching", severity: "win", confidence: "med",
        message: `Only ${Math.round(readShare * 100)}% of your input is cached — a lot is being re-sent at full price.`,
        estSaveUSD: save, estSavePct: pctOf(save), autoApply: "amber",
        action: "Cache your stable prefix (system prompt, tool defs, long docs). Cache reads cost ~10% of normal input.",
      });
    }
  }

  // ---- D1: model tiering ----
  if (opusCost / total > 0.5) {
    const shiftable = 0.3, tierDiscount = 0.4;
    const save = opusCost * shiftable * tierDiscount;
    findings.push({
      techniqueId: "D1", title: "Model tiering", severity: "win", confidence: "low",
      message: `${Math.round(pctOf(opusCost))}% of spend is on Opus (your most expensive tier).`,
      estSaveUSD: save, estSavePct: pctOf(save), autoApply: "amber",
      action: "Route simpler work (classify, extract, format, quick edits) to Sonnet/Haiku; keep Opus for hard reasoning.",
    });
  } else if (opusCost > 0) {
    findings.push({
      techniqueId: "D1", title: "Model tiering", severity: "ok", confidence: "med",
      message: `Opus is only ${Math.round(pctOf(opusCost))}% of spend — your model mix looks reasonable.`,
      estSaveUSD: 0, estSavePct: 0, autoApply: "n/a",
      action: "No action — you're not over-relying on the most expensive model.",
    });
  }

  // ---- C1: output discipline ----
  const outShare = pctOf(outputCost);
  if (outShare > 25) {
    const save = outputCost * 0.15;
    findings.push({
      techniqueId: "C1", title: "Output discipline", severity: "win", confidence: "low",
      message: `Output is ${Math.round(outShare)}% of your spend — and output costs ~5x input.`,
      estSaveUSD: save, estSavePct: pctOf(save), autoApply: "green",
      action: "Set a max_tokens ceiling and ask for concise answers where you don't need long ones.",
    });
  }

  // ================= per-session detectors =================
  sessionDetectors(u, findings, pctOf, cacheReadCost);

  // ---- rank: wins first (by $), then info, then ok ----
  const order = { win: 0, info: 1, ok: 2 } as const;
  findings.sort((a, b) =>
    order[a.severity] - order[b.severity] || b.estSaveUSD - a.estSaveUSD);

  const totalEstSaveUSD = findings.reduce((s, f) => s + f.estSaveUSD, 0);
  const wins = findings.filter((f) => f.severity === "win");

  return {
    findings,
    totalEstSaveUSD,
    totalEstSavePct: pctOf(totalEstSaveUSD),
    alreadyEfficient: wins.length === 0,
  };
}

/**
 * The deep pass. Even when totals look efficient, a single session can hide the
 * real story. These detectors read u.bySession (per-session rollups) directly.
 */
function sessionDetectors(
  u: UsageSummary,
  findings: Finding[],
  pctOf: (v: number) => number,
  cacheReadCost: number,
): void {
  const sessions = u.bySession ?? [];
  if (sessions.length === 0) return;

  // ---- expensive-session outlier ----
  if (sessions.length >= 4) {
    const top = sessions[0]; // already sorted by cost desc
    const share = pctOf(top.costUSD);
    if (share >= 35) {
      findings.push({
        techniqueId: "—", title: "Concentrated spend", severity: "info", confidence: "high",
        message: `One session (${short(top.id)}) was ${Math.round(share)}% of your spend — ${"$" + top.costUSD.toFixed(2)} across ${top.turns} turns.`,
        estSaveUSD: 0, estSavePct: 0, autoApply: "n/a",
        action: "Worth a look — long single sessions are where bloat and re-reads pile up. The findings below may point at this one.",
      });
    }
  }

  // ---- bloated stable context (B1: system prompt / CLAUDE.md / tool defs) ----
  let prefixTokTurns = 0, totalTurns = 0;
  for (const s of sessions) {
    if (s.turns < 3) continue;
    prefixTokTurns += s.avgCachePrefix * s.turns;
    totalTurns += s.turns;
  }
  const typicalPrefix = totalTurns > 0 ? prefixTokTurns / totalTurns : 0;
  const BLOAT = 25_000; // tokens — a lean setup is ~5–15k
  if (typicalPrefix >= BLOAT) {
    const trim = 0.2; // assume a fifth is trimmable boilerplate
    const save = cacheReadCost * trim;
    const worst = sessions.filter((s) => s.turns >= 3)
      .sort((a, b) => b.avgCachePrefix - a.avgCachePrefix)[0];

    // Cross-reference: which configured MCP servers ride the prefix but were
    // never actually called? Turns "drop unused servers" from generic advice
    // into a named, evidence-backed action — pure log math, zero tokens.
    const servers = u.mcpServers ?? [];
    const invoked = new Set(u.invokedMcpServers ?? []);
    const unused = servers.filter((s) => !invoked.has(s));

    let named = "";
    let act = `Trim CLAUDE.md and drop unused tools/MCP servers. It's cached so it's cheap per token — but it rides every single call.`;
    let conf: Finding["confidence"] = "low";

    if (unused.length > 0) {
      conf = invoked.size > 0 ? "med" : "low";
      const list = unused.slice(0, 6).map(shortServer).join(", ") + (unused.length > 6 ? "…" : "");
      const verb = invoked.size > 0 ? "were never called" : "showed no calls";
      named = ` ${unused.length} of ${servers.length} configured MCP server${servers.length > 1 ? "s" : ""} ${verb} in these logs — their tool defs ride every request anyway: ${list}.`;
      act = `Remove the unused MCP server${unused.length > 1 ? "s" : ""} from this project's config (${list}) — each one's tool schemas sit in your cached prefix on every call. Then trim CLAUDE.md.`;
    } else if (servers.length > 0) {
      named = ` ${servers.length} MCP server${servers.length > 1 ? "s" : ""} ${servers.length > 1 ? "ride" : "rides"} it, and all see use: ${servers.slice(0, 8).map(shortServer).join(", ")}${servers.length > 8 ? "…" : ""}.`;
      act = `Your MCP servers all get called, so the prefix is mostly earning its keep — trim CLAUDE.md and any tools/sections you don't need.`;
    }

    findings.push({
      techniqueId: "B1", title: "Bloated stable context", severity: "win", confidence: conf,
      message: `Your cached prefix is ~${fmtTok(typicalPrefix)} tokens, re-read on every turn (worst session: ~${fmtTok(worst.avgCachePrefix)}). That's your system prompt + CLAUDE.md + tool defs.${named}`,
      estSaveUSD: save, estSavePct: pctOf(save), autoApply: "amber",
      action: act,
    });
  }

  // ---- repeated file re-reads (B3) ----
  type Worst = { path: string; reads: number; session: string };
  const offenders: Worst[] = [];
  let extraReads = 0;
  for (const s of sessions) {
    for (const r of s.repeatedReads) {
      extraReads += r.reads - 1;
      if (r.reads >= 3) offenders.push({ path: r.path, reads: r.reads, session: s.id });
    }
  }
  offenders.sort((a, b) => b.reads - a.reads);
  if (offenders.length > 0) {
    const rate = ratesFor(u.byModel[0]?.model ?? "").input;
    const save = (extraReads * 2000 * rate) / 1_000_000;
    const top = offenders[0];
    findings.push({
      techniqueId: "B3", title: "Repeated file reads", severity: "win", confidence: "low",
      message: `${offenders.length} file${offenders.length > 1 ? "s" : ""} re-read 3+ times in a session (worst: ${base(top.path)} ×${top.reads}). ${extraReads} redundant reads total.`,
      estSaveUSD: save, estSavePct: pctOf(save), autoApply: "amber",
      action: "Read once, keep it in context. A Claude Code hook can warn when a file already in context gets re-read.",
    });
  }
}

const short = (id: string) => (id.length > 8 ? id.slice(0, 8) : id);
const base = (p: string) => p.replace(/\\/g, "/").split("/").pop() || p;
// MCP server names can be long UUIDs; keep them legible in the report.
const shortServer = (s: string) => (s.length > 22 ? s.slice(0, 10) + "…" : s);
