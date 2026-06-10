import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenCounts } from "./types";

interface Rates { input: number; output: number; cacheWrite: number; cacheRead: number; }
interface PricingFile {
  version: string;
  models: (Rates & { match: string })[];
  default: Rates;
}

let cached: PricingFile | null = null;

function load(): PricingFile {
  if (cached) return cached;
  const path = join(__dirname, "..", "..", "data", "pricing.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as PricingFile;
  return cached;
}

/** Pick rates for a model id by substring match (robust to version drift). */
export function ratesFor(model: string): Rates {
  const p = load();
  const m = (model || "").toLowerCase();
  for (const entry of p.models) {
    if (m.includes(entry.match)) return entry;
  }
  return p.default;
}

/** Estimated USD cost for a bundle of token counts on a given model. */
export function costOf(counts: TokenCounts, model: string): number {
  const r = ratesFor(model);
  return (
    (counts.input * r.input +
      counts.output * r.output +
      counts.cacheWrite * r.cacheWrite +
      counts.cacheRead * r.cacheRead) /
    1_000_000
  );
}
