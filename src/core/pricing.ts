import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenCounts } from "./types";

export interface Rates { input: number; output: number; cacheWrite: number; cacheRead: number; cacheWrite1h?: number; }

export interface ModelEntry extends Rates {
  id: string;
  label: string;
  family: string;
  match: string[];
  tokenizer?: "v1" | "v2";
  status?: "current" | "deprecated" | "retired" | "limited";
  introUntil?: string;
  standard?: Rates;
  fastMode?: { input: number; output: number };
}

interface PricingFile {
  version: string;
  updated: string;
  models: ModelEntry[];
  default: string;
  extras?: Record<string, any>;
}

let cached: PricingFile | null = null;

function load(): PricingFile {
  if (cached) return cached;
  const path = join(__dirname, "..", "..", "data", "pricing.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as PricingFile;
  return cached;
}

/** Every model we hold prices for. */
export function allModels(): ModelEntry[] {
  return load().models;
}

/** Models a user would realistically be billed for today. */
export function currentModels(): ModelEntry[] {
  return load().models.filter((m) => m.status === "current");
}

/**
 * Resolve a model id to its catalogue entry. Matching is longest-token-first so
 * "claude-opus-4-8" never falls through to a looser "opus-4" rule.
 */
export function modelFor(model: string): ModelEntry {
  const p = load();
  const m = (model || "").toLowerCase().replace(/[._]/g, "-");
  const candidates = p.models
    .flatMap((entry) => entry.match.map((token) => ({ entry, token: token.toLowerCase().replace(/[._]/g, "-") })))
    .sort((a, b) => b.token.length - a.token.length);
  for (const c of candidates) if (m.includes(c.token)) return c.entry;
  return p.models.find((x) => x.id === p.default) || p.models[0];
}

/**
 * Rates for a model, honouring time-limited introductory pricing.
 * Sonnet 5 is $2/$10 through 2026-08-31 and $3/$15 after, so the correct
 * answer genuinely depends on when you ask.
 */
export function ratesFor(model: string, when?: Date): Rates {
  const e = modelFor(model);
  if (e.introUntil && e.standard) {
    const now = when || new Date();
    const cutoff = new Date(e.introUntil + "T23:59:59Z");
    if (now > cutoff) return e.standard;
  }
  return { input: e.input, output: e.output, cacheWrite: e.cacheWrite, cacheRead: e.cacheRead, cacheWrite1h: e.cacheWrite1h };
}

/** Human label for a model id, e.g. "Opus 4.8". */
export function labelFor(model: string): string {
  return modelFor(model).label;
}

/**
 * Claude 4.7 and later use a newer tokenizer that produces roughly 30% more
 * tokens for the same text. Estimating from character counts has to account
 * for that, or every figure for those models is understated.
 */
export function tokenizerFactor(model: string): number {
  return modelFor(model).tokenizer === "v2" ? 1.3 : 1;
}

/** Extra pricing facts (web search rate, tool overheads, batch discount, ...). */
export function extras(): Record<string, any> {
  return load().extras || {};
}

/** Estimated USD cost for a bundle of token counts on a given model. */
export function costOf(counts: TokenCounts, model: string, when?: Date): number {
  const r = ratesFor(model, when);
  return (
    (counts.input * r.input +
      counts.output * r.output +
      counts.cacheWrite * r.cacheWrite +
      counts.cacheRead * r.cacheRead) /
    1_000_000
  );
}
