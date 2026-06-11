import type { UsageSummary } from "./types";
import { costOf } from "./pricing";

/**
 * Step 7 — the waste fingerprint.
 * A one-line, shareable signature of how you spend tokens, plus an efficiency
 * score out of 100. Deterministic and zero-token — the same property as the
 * rest of Obol. It's the bit people screenshot.
 */

export interface Fingerprint {
  score: number;             // 0..100 efficiency score
  grade: string;             // A+ … F
  traits: string[];          // short tags, worst-first
  badge: string;             // one-line summary, e.g. "Cache-leaky · Opus-heavy · 47/100"
  cacheReadPct: number;
  opusPct: number;
  outputPct: number;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function grade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}

export function fingerprint(u: UsageSummary): Fingerprint {
  // component shares
  const inputSide = u.input + u.cacheRead;
  const cacheReadPct = inputSide > 0 ? (u.cacheRead / inputSide) * 100 : 0;

  let opusCost = 0, outputCost = 0;
  for (const m of u.byModel) {
    if (m.model.toLowerCase().includes("opus")) opusCost += m.costUSD;
    outputCost += costOf({ input: 0, output: m.output, cacheWrite: 0, cacheRead: 0 }, m.model);
  }
  const opusPct = u.totalCostUSD > 0 ? (opusCost / u.totalCostUSD) * 100 : 0;
  const outputPct = u.totalCostUSD > 0 ? (outputCost / u.totalCostUSD) * 100 : 0;

  // sub-scores (higher = healthier)
  const cacheScore = clamp(cacheReadPct * 1.25);           // 80% reads -> 100
  const routeScore = clamp(100 - Math.max(0, opusPct - 50) * 2);
  const outputScore = clamp(100 - Math.max(0, outputPct - 25) * 1.6);
  const score = Math.round(0.40 * cacheScore + 0.35 * routeScore + 0.25 * outputScore);

  // traits, worst first
  const traits: { tag: string; bad: number }[] = [];
  if (cacheReadPct < 70) traits.push({ tag: "Cache-leaky", bad: 70 - cacheReadPct });
  else traits.push({ tag: "Cache-tight", bad: -1 });
  if (opusPct > 50) traits.push({ tag: "Opus-heavy", bad: opusPct - 50 });
  if (outputPct > 25) traits.push({ tag: "Verbose-output", bad: outputPct - 25 });

  // a re-read habit, if any session shows it
  const rereads = (u.bySession ?? []).reduce((n, s) => n + s.repeatedReads.length, 0);
  if (rereads > 0) traits.push({ tag: "Re-reader", bad: rereads });

  const sorted = traits.filter((t) => t.bad > 0 || t.tag === "Cache-tight")
    .sort((a, b) => b.bad - a.bad).map((t) => t.tag).slice(0, 3);
  const finalTraits = sorted.length ? sorted : ["Lean"];

  return {
    score, grade: grade(score), traits: finalTraits,
    badge: `${finalTraits.join(" · ")} · ${score}/100 (${grade(score)})`,
    cacheReadPct, opusPct, outputPct,
  };
}
