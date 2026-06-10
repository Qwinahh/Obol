import type { UsageSummary } from "./types";
import { ratesFor } from "./pricing";

/**
 * Step 3 — the Proof Engine.
 * Receipts, not promises. The diagnosis (Step 2) *estimates* future savings;
 * this measures a saving that has ALREADY happened, straight from the real
 * cached-vs-uncached token split in your logs. No model call, no API key, no
 * assumptions — just the two prices applied to the tokens you actually moved.
 *
 * The cache receipt answers: "what would my reused context have cost at full
 * input price, versus what it actually cost as cache writes + reads?" The gap
 * is money caching already saved you, to the cent your rates allow.
 */

export interface CacheReceipt {
  /** reused-context tokens that hit the cache (read + write) */
  cachedTokens: number;
  /** what those tokens would have cost billed as full-price input */
  hypotheticalNoCacheUSD: number;
  /** what they actually cost (reads at ~10%, writes at ~125%) */
  actualUSD: number;
  /** measured dollars caching already saved */
  savedUSD: number;
  /** saved as a share of the no-cache hypothetical */
  savedPct: number;
}

export interface Proof {
  /** true when there was cached traffic to measure */
  hasCacheReceipt: boolean;
  cache: CacheReceipt;
}

/** Measure dollars prompt caching has already saved, per model-correct rates. */
export function measureCacheSavings(u: UsageSummary): CacheReceipt {
  let cachedTokens = 0, hypothetical = 0, actual = 0;
  for (const m of u.byModel) {
    const r = ratesFor(m.model);
    const reused = m.cacheRead + m.cacheWrite;
    cachedTokens += reused;
    // counterfactual: with no caching, every reused token is full-price input
    hypothetical += (reused * r.input) / 1_000_000;
    // reality: reads at the cache-read rate, writes at the cache-write rate
    actual += (m.cacheRead * r.cacheRead + m.cacheWrite * r.cacheWrite) / 1_000_000;
  }
  const savedUSD = hypothetical - actual;
  return {
    cachedTokens,
    hypotheticalNoCacheUSD: hypothetical,
    actualUSD: actual,
    savedUSD,
    savedPct: hypothetical > 0 ? (savedUSD / hypothetical) * 100 : 0,
  };
}

export function proof(u: UsageSummary): Proof {
  const cache = measureCacheSavings(u);
  return { hasCacheReceipt: cache.cachedTokens > 0 && u.found, cache };
}
