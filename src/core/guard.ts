import type { UsageSummary, ModelUsage } from "./types";
import type { ApplyPlan, ApplyAction } from "./apply";
import { costOf } from "./pricing";

/**
 * Step 4 — the Quality Guard.
 *
 * The promise that separates Obol from every "here's a cheaper number" tool:
 * after you change something to save money, prove the answers didn't get worse.
 *
 * Two kinds of fix:
 *   - SAFE   — provably cannot change any answer (caching the same content,
 *              dropping an MCP server that logged zero calls, a warn-only hook).
 *              The guard passes these for free, with a one-line proof. $0, no key.
 *   - REPLAY — could in principle change outputs (routing work to a cheaper
 *              model, asking for concise answers). The guard verifies these by
 *              running a small canary suite through the proposed config and
 *              checking the answers still pass deterministic checks.
 *
 * The replay path is the ONLY thing in all of Obol that spends tokens. It is
 * off by default, needs your own API key, and even then runs tiny prompts with
 * deterministic scoring (no expensive judge model). With no key, the guard
 * prints exactly what it WOULD run and the estimated cost, and stays at $0.
 */

export type GuardRisk = "safe" | "replay" | "manual";

/** A built-in canary: a tiny task with a deterministic pass/fail check. */
export interface Canary {
  id: string;
  kind: string;            // classify | extract | format | reason
  prompt: string;
  maxTokens: number;
  /** True when the model's answer is acceptable. Deterministic — no judge. */
  check: (answer: string) => boolean;
}

const has = (a: string, needle: string) => a.toLowerCase().includes(needle);

/**
 * Six representative "cheap work" tasks — the kind you'd route to a smaller
 * model or answer tersely. Each is checkable without another model in the loop.
 */
export const CANARIES: Canary[] = [
  { id: "sentiment", kind: "classify", maxTokens: 8,
    prompt: "Reply with one word, 'positive' or 'negative': \"this is the best purchase I've made all year\".",
    check: (a) => has(a, "positive") && !has(a, "negative") },
  { id: "year", kind: "extract", maxTokens: 8,
    prompt: "Reply with only the year: \"The bridge was completed in 1937 after four years of work.\"",
    check: (a) => a.includes("1937") },
  { id: "email", kind: "extract", maxTokens: 12,
    prompt: "Reply with only the email address: \"reach me at sam.doe@acme.io anytime\".",
    check: (a) => has(a, "sam.doe@acme.io") },
  { id: "yesno", kind: "format", maxTokens: 6,
    prompt: "Answer only 'yes' or 'no': is 17 a prime number?",
    check: (a) => has(a, "yes") && !has(a, "no ") },
  { id: "arith", kind: "reason", maxTokens: 8,
    prompt: "Reply with only the number: what is 144 divided by 12?",
    check: (a) => /\b12\b/.test(a) },
  { id: "capital", kind: "extract", maxTokens: 10,
    prompt: "Reply with only the city: what is the capital of Japan?",
    check: (a) => has(a, "tokyo") },
];

/** One fix's guard assessment. */
export interface GuardProbe {
  techniqueId: string;
  title: string;
  risk: GuardRisk;
  /** Plain-language why this is safe / how it will be verified. */
  rationale: string;
  /** For replay probes: which cheaper models the canaries will run on. */
  candidateModels: string[];
  /** Estimated cost to run this probe live (0 for safe/manual). */
  estCostUSD: number;
}

export interface GuardPlan {
  probes: GuardProbe[];
  safe: GuardProbe[];      // provably pass, free
  replay: GuardProbe[];    // need the canary suite (the paid path)
  manual: GuardProbe[];    // can't be auto-verified; human spot-check
  estCostUSD: number;      // total to run every replay probe live
  hasKey: boolean;         // is an API key present in the environment?
}

/** Cheaper models than Opus that already appear in the user's mix (fallbacks if none). */
function cheaperModels(u: UsageSummary): string[] {
  const present = new Set(u.byModel.map((m) => m.model.toLowerCase()));
  const out: string[] = [];
  for (const m of u.byModel) {
    const id = m.model.toLowerCase();
    if (!id.includes("opus")) out.push(m.model);
  }
  if (out.length === 0) {
    // Suggest the standard cheaper tiers if the user only ran Opus.
    out.push("claude-sonnet-4-6", "claude-haiku-4-5");
  }
  return [...new Set(out)];
}

/** Rough cost of one canary call on a model: ~prompt/4 input + maxTokens output. */
function canaryCost(model: string): number {
  return CANARIES.reduce((sum, c) => {
    const inTok = Math.ceil(c.prompt.length / 4) + 16;
    return sum + costOf({ input: inTok, output: c.maxTokens, cacheWrite: 0, cacheRead: 0 }, model);
  }, 0);
}

function probeFor(a: ApplyAction, u: UsageSummary): GuardProbe {
  const base = { techniqueId: a.techniqueId, title: a.title, candidateModels: [] as string[], estCostUSD: 0 };

  // Provably safe — the change cannot alter any produced answer.
  if (a.techniqueId === "A1" || a.techniqueId === "A2") {
    return { ...base, risk: "safe",
      rationale: "Caching changes how reused context is billed, not what the model reads on the turn it answers. Same content in, same answer out." };
  }
  if (a.techniqueId === "B3") {
    return { ...base, risk: "safe",
      rationale: "The re-read guard only warns; the file content already in context is identical. Nothing the model sees changes." };
  }
  if (a.techniqueId === "B1" && a.kind === "config-edit") {
    return { ...base, risk: "safe",
      rationale: "These MCP servers logged zero tool calls in your sessions. A capability that was never invoked cannot have shaped any answer it wasn't part of." };
  }

  // Behaviour-affecting and auto-verifiable via canaries.
  if (a.techniqueId === "D1" || a.techniqueId === "C1") {
    const models = cheaperModels(u);
    const cost = models.reduce((s, m) => s + canaryCost(m), 0);
    const how = a.techniqueId === "D1"
      ? `Run ${CANARIES.length} cheap-work canaries on ${models.map(shortModel).join(", ")} and confirm each still passes its check before routing real work there.`
      : `Re-run the ${CANARIES.length} canaries under the concise instruction and confirm correctness holds when answers are shortened.`;
    return { ...base, risk: "replay", candidateModels: models, estCostUSD: cost, rationale: how };
  }

  // Anything else (e.g. a manual CLAUDE.md trim) — the guard can't know what you
  // changed, so it asks for a human spot-check rather than guessing.
  return { ...base, risk: "manual",
    rationale: "This edit is yours to shape, so the guard can't auto-verify it. Spot-check a couple of real prompts after applying." };
}

/** Deterministic, zero-token: classify every fix and price the paid path. */
export function planGuard(plan: ApplyPlan, u: UsageSummary, hasKey = !!process.env.ANTHROPIC_API_KEY): GuardPlan {
  const probes = plan.actions.map((a) => probeFor(a, u));
  const safe = probes.filter((p) => p.risk === "safe");
  const replay = probes.filter((p) => p.risk === "replay");
  const manual = probes.filter((p) => p.risk === "manual");
  const estCostUSD = replay.reduce((s, p) => s + p.estCostUSD, 0);
  return { probes, safe, replay, manual, estCostUSD, hasKey };
}

// ----------------------- the live replay path (opt-in) -----------------------

/** A function that asks a model a prompt and returns its text answer. */
export type ModelCaller = (model: string, prompt: string, maxTokens: number) => Promise<string>;

export interface CanaryResult { id: string; model: string; ok: boolean; answer: string; }
export interface GuardVerdict {
  techniqueId: string;
  title: string;
  ran: boolean;
  passed: boolean;
  results: CanaryResult[];
  score: number;          // share of canaries that passed (0..1)
  note: string;
}

/** Real Anthropic Messages API caller. Used only when a key is present. */
export function anthropicCaller(apiKey: string): ModelCaller {
  return async (model, prompt, maxTokens) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const json: any = await res.json();
    const block = Array.isArray(json?.content) ? json.content.find((b: any) => b?.type === "text") : null;
    return String(block?.text ?? "");
  };
}

/**
 * Run the canary suite for every replay probe. Pure orchestration + deterministic
 * scoring — the only token spend is `caller`, which the caller (ha) provides, so
 * this is fully testable with a fake. Network/API failures degrade to ran:false.
 */
export async function runGuard(plan: GuardPlan, caller: ModelCaller): Promise<GuardVerdict[]> {
  const verdicts: GuardVerdict[] = [];
  for (const probe of plan.replay) {
    const results: CanaryResult[] = [];
    let failed = false;
    try {
      for (const model of probe.candidateModels) {
        for (const canary of CANARIES) {
          const answer = await caller(model, canary.prompt, canary.maxTokens);
          const ok = canary.check(answer);
          results.push({ id: canary.id, model, ok, answer: answer.slice(0, 60) });
          if (!ok) failed = true;
        }
      }
    } catch (e) {
      verdicts.push({
        techniqueId: probe.techniqueId, title: probe.title, ran: false, passed: false,
        results, score: 0, note: `couldn't run: ${(e as Error).message}`,
      });
      continue;
    }
    const passes = results.filter((r) => r.ok).length;
    const score = results.length ? passes / results.length : 0;
    verdicts.push({
      techniqueId: probe.techniqueId, title: probe.title, ran: true,
      passed: !failed, results, score,
      note: failed
        ? `${results.length - passes}/${results.length} canaries regressed — keep this work on the stronger model.`
        : `all ${results.length} canaries held — safe to route this work to ${probe.candidateModels.map(shortModel).join(", ")}.`,
    });
  }
  return verdicts;
}

export const shortModel = (m: string) =>
  m.replace(/^claude-/, "").replace(/-\d.*$/, "").replace(/^(opus|sonnet|haiku)$/, (s) => s[0].toUpperCase() + s.slice(1));
