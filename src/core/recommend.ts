import type { Diagnosis } from "./types";
import type { ApplyPlan } from "./apply";

/**
 * Step 11 — the recommender.
 * Cuts through the full diagnosis to "if you do one thing, do this." Green
 * (safe, ~1 minute) is ordered ahead of amber (review), then by dollars. Pure
 * ranking over what's already been computed — deterministic, zero-token.
 */

export interface NextStep {
  rank: number;
  title: string;
  detail: string;
  effort: string;       // "1 min · safe" | "review"
  estSaveUSD: number;
  tier: "green" | "amber";
}

export function recommend(d: Diagnosis, plan: ApplyPlan, max = 3): NextStep[] {
  const ordered = [...plan.actions].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "green" ? -1 : 1;
    return b.estSaveUSD - a.estSaveUSD;
  });
  return ordered.slice(0, max).map((a, i) => ({
    rank: i + 1,
    title: a.title,
    detail: a.summary,
    effort: a.tier === "green" ? "1 min · safe + reversible" : "review first",
    estSaveUSD: a.estSaveUSD,
    tier: a.tier,
  }));
}
