#!/usr/bin/env node
/**
 * Obol circuit breaker — Step 8.
 *
 * Fires when Claude finishes a response (Stop). It tallies the CURRENT session's
 * real token spend straight from its transcript and, once that crosses a
 * threshold ($5 → $10 → $20 → $40), nudges you once: long sessions are where a
 * bloated cached prefix and repeated re-reads quietly compound.
 *
 * Fail-safe by design: it never blocks anything. Any error, odd input, or missing
 * transcript and it exits 0 in silence. Local, zero-token — it only reads a file
 * you already have. Pricing is read from the bundled catalog, with a safe inline
 * fallback so it works even if the data file moves.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FALLBACK = {
  models: [
    { match: "opus", input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    { match: "sonnet", input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    { match: "haiku", input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  ],
  default: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
};
const THRESHOLDS = [5, 10, 20, 40, 80];

function loadPricing() {
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    if (root) {
      const p = join(root, "data", "pricing.json");
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    }
  } catch { /* fall through */ }
  return FALLBACK;
}

function ratesFor(pricing, model) {
  const m = String(model || "").toLowerCase();
  for (const e of pricing.models) if (m.includes(e.match)) return e;
  return pricing.default;
}

function sessionCost(transcriptPath, pricing) {
  let cost = 0, turns = 0;
  const raw = readFileSync(transcriptPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const usage = row?.message?.usage;
    if (!usage) continue;
    const r = ratesFor(pricing, row?.message?.model);
    const inp = usage.input_tokens ?? 0;
    const out = usage.output_tokens ?? 0;
    const cw = usage.cache_creation_input_tokens ?? 0;
    const cr = usage.cache_read_input_tokens ?? 0;
    cost += (inp * r.input + out * r.output + cw * r.cacheWrite + cr * r.cacheRead) / 1_000_000;
    if (out > 0) turns++;
  }
  return { cost, turns };
}

function main() {
  let evt;
  try { evt = JSON.parse(readFileSync(0, "utf8")); } catch { return; }
  const transcript = evt?.transcript_path;
  if (typeof transcript !== "string" || !existsSync(transcript)) return;

  const pricing = loadPricing();
  const { cost, turns } = sessionCost(transcript, pricing);

  const crossed = THRESHOLDS.filter((t) => cost >= t).pop();
  if (!crossed) return;

  const session = String(evt?.session_id ?? "default").replace(/[^A-Za-z0-9_.-]/g, "_");
  const dir = join(tmpdir(), "obol-circuit");
  const store = join(dir, `${session}.json`);
  let warnedAt = 0;
  try { if (existsSync(store)) warnedAt = JSON.parse(readFileSync(store, "utf8")).warnedAt ?? 0; } catch { warnedAt = 0; }
  if (crossed <= warnedAt) return; // already nudged at this tier

  try { mkdirSync(dir, { recursive: true }); writeFileSync(store, JSON.stringify({ warnedAt: crossed })); } catch { /* ignore */ }

  process.stderr.write(
    `\n◎ obol — this session has spent ~$${cost.toFixed(2)} across ${turns} turns. ` +
    `Long sessions quietly re-bill a bloated prefix and re-read files. ` +
    `If you've changed topic, /clear or a fresh session resets the cached context. ` +
    `Run /obol:optimize for the breakdown.\n`,
  );
}

try { main(); } catch { /* never block */ }
process.exit(0);
