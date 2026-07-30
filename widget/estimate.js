"use strict";
/*
 * Obol estimator — "what will this prompt cost me?"
 *
 * Prices the next turn locally (zero tokens) against the real model catalogue,
 * using YOUR session's measured context as the baseline rather than a generic
 * guess. Accuracy details that matter and are easy to get wrong:
 *
 *   - Every model is priced individually (Opus 5 and Opus 4.1 differ 3x).
 *   - Sonnet 5's introductory rate expires 2026-08-31, so pricing is date-aware.
 *   - Claude 4.7+ use a newer tokenizer that yields ~30% more tokens for the
 *     same text, so character-based estimates are scaled per model.
 *   - Web search is billed per search ($10/1000) on top of tokens.
 */
const factors = require("./factors.js");

/* ~4 characters per token for English prose and code, before the per-model
   tokenizer adjustment. */
const CHARS_PER_TOKEN = 4;

function baseTokens(text) { return Math.max(1, Math.ceil(String(text || "").length / CHARS_PER_TOKEN)); }

/* Expected reply size, from the classifier's volume score and the mode. */
function expectedOutput(cls, mode) {
  const base = 350 + Math.max(0, cls.volume) * 450 + Math.max(0, cls.complexity) * 120;
  const factor = mode === "careful" ? 0.45 : mode === "aggressive" ? 1.6 : 1;
  return Math.round(Math.min(base * factor, 32000));
}

/*
 * How many model round trips this turn will take.
 *
 * This is the single biggest driver people miss. A conversational answer is one
 * request. An agentic task ("build this", "fix the tests") fans out into many
 * tool calls, and EVERY round re-sends the whole conversation context. Measured
 * against real transcripts, ignoring this understated agentic turns by ~10x.
 */
const AGENTIC = /\b(build|implement|create|write|add|fix|refactor|debug|migrate|deploy|install|run|test|set ?up|wire|integrate|generate|scaffold|update|change|edit|rename|delete|remove|commit|push)\b/i;
const MULTI = /\b(then|after that|also|next|finally|and then|as well|plus)\b/gi;
function expectedRounds(cls, text, mode) {
  const t = String(text || "");
  if (!AGENTIC.test(t)) return 1;                    // pure question or discussion
  let rounds = 3;                                     // read, act, verify
  rounds += Math.max(0, Math.min(8, cls.complexity)); // harder work loops more
  rounds += Math.max(0, Math.min(6, cls.volume));     // more output, more steps
  rounds += Math.min(5, (t.match(MULTI) || []).length) * 2;
  if (/\b(entire|whole|all|every|end to end|end-to-end|from scratch)\b/i.test(t)) rounds += 6;
  if (/\b(and|,)\b/.test(t) && t.length > 200) rounds += 3;
  const factor = mode === "careful" ? 0.7 : mode === "aggressive" ? 1.25 : 1;
  return Math.max(1, Math.round(rounds * factor));
}

/*
 * The same sentence can end in a one-line answer or an hour of work. Rather than
 * pretend otherwise, Obol gives a range whenever the outcome is genuinely open,
 * and a single figure only when the ask is unambiguous.
 */
const OPEN_ENDED = /\b(how (?:can|do|would|should)|what about|what if|can we|could we|any way|is there a way|thoughts on|ideas for|help me)\b/i;
function roundRange(cls, text, mode) {
  const t = String(text || "");
  const agentic = AGENTIC.test(t);
  const open = OPEN_ENDED.test(t);
  const full = expectedRounds(cls, text, mode);
  if (agentic) return { low: Math.max(1, Math.round(full * 0.45)), high: Math.round(full * 1.8), typical: full, open: false };
  if (open) {
    // reads like a question, but this class of ask often turns into real work
    const asIfAgentic = Math.max(4, Math.round((3 + Math.max(0, cls.complexity)) * (mode === "careful" ? 0.7 : mode === "aggressive" ? 1.25 : 1)));
    return { low: 1, high: Math.round(asIfAgentic * 1.8), typical: Math.max(1, Math.round(asIfAgentic * 0.6)), open: true };
  }
  return { low: 1, high: 1, typical: 1, open: false };
}

/* Careful reuses loaded context and avoids re-reads; aggressive explores more. */
function contextFactor(mode) {
  return mode === "careful" ? 0.75 : mode === "aggressive" ? 1.15 : 1;
}
function outputFactor(mode) {
  return mode === "careful" ? 0.6 : mode === "aggressive" ? 1.15 : 1;
}

/* Which models to price. Defaults to the current line-up, with the model you
   are actually on pinned first so the comparison is grounded. */
function pickModels(core, currentModel) {
  let list = [];
  try { list = core.currentModels().filter((m) => m.status === "current" && m.family !== "mythos"); } catch (e) {}
  if (!list.length) return [];
  const seen = new Set();
  const out = [];
  if (currentModel) {
    try {
      const mine = core.modelFor(currentModel);
      if (mine && mine.family !== "mythos") { out.push(mine); seen.add(mine.id); }
    } catch (e) {}
  }
  // One representative per family (the current flagship), so the list stays readable.
  for (const fam of ["haiku", "sonnet", "opus", "fable"]) {
    const inFam = list.filter((m) => m.family === fam && !seen.has(m.id));
    if (inFam.length) { out.push(inFam[0]); seen.add(inFam[0].id); }
  }
  return out;
}

function estimate(core, opts) {
  const { text, mode, classify, sessionAvgContext, currentModel } = opts;
  const cls = classify(text);
  const chosen = mode && mode !== "auto" ? mode : cls.mode;
  const rawIn = baseTokens(text);
  const ctxBase = Math.round((sessionAvgContext || 0) * contextFactor(chosen));

  // Hidden drivers: artifacts, images, search results, file reads, long output.
  const found = factors.detect(text, opts.factorOpts || {});
  const extraIn = found.filter((f) => f.kind === "input").reduce((a, f) => a + f.tokens, 0);
  const extraOut = found.filter((f) => f.kind === "output").reduce((a, f) => a + f.tokens, 0);
  const searches = found.some((f) => f.id === "search") ? 1 : 0;

  let ex = {};
  try { ex = core.pricingExtras ? core.pricingExtras() : {}; } catch (e) {}
  const searchFee = (searches * (ex.webSearchPer1000 || 0)) / 1000;

  const rr = roundRange(cls, text, chosen);
  const rounds = rr.typical;
  const when = opts.when || new Date();
  const models = pickModels(core, currentModel).map((entry) => {
    const rates = core.ratesFor(entry.id, when);
    const tf = core.tokenizerFactor ? core.tokenizerFactor(entry.id) : 1;
    // Text-derived counts scale with the model's tokenizer; measured session
    // context does not (it is already counted in that model's own tokens).
    const inTok = Math.round((rawIn + extraIn) * tf);
    const outTok = Math.round((expectedOutput(cls, chosen) + extraOut * outputFactor(chosen)) * tf);
    // Context is re-sent on every round; the prompt only on the first.
    const price = (n, outMul) =>
      (inTok * rates.input) / 1e6 +
      (outTok * (outMul || 1) * rates.output) / 1e6 +
      (ctxBase * n * rates.cacheRead) / 1e6 +
      searchFee;
    const cost = price(rounds, 1);
    return {
      id: entry.id, label: entry.label, family: entry.family,
      cost, costLow: price(rr.low, 0.6), costHigh: price(rr.high, 1.7), inTok, outTok,
      intro: !!(entry.introUntil && rates.input === entry.input),
    };
  });

  // What the mode choice is worth, held on one model for a fair comparison.
  const refId = (models[0] && models[0].id) || "claude-sonnet-5";
  const refRates = core.ratesFor(refId, when);
  const refTf = core.tokenizerFactor ? core.tokenizerFactor(refId) : 1;
  const byMode = {};
  for (const m of ["careful", "balanced", "aggressive"]) {
    const inTok = Math.round((rawIn + extraIn) * refTf);
    const outTok = Math.round((expectedOutput(cls, m) + extraOut * outputFactor(m)) * refTf);
    const ctx = Math.round((sessionAvgContext || 0) * contextFactor(m));
    const rrM = roundRange(cls, text, m).typical;
    byMode[m] =
      (inTok * refRates.input) / 1e6 +
      (outTok * refRates.output) / 1e6 +
      (ctx * rrM * refRates.cacheRead) / 1e6 +
      searchFee;
  }

  return {
    mode: chosen, recommended: cls.mode, reasons: cls.reasons,
    promptTokens: rawIn, contextTokens: ctxBase,
    outputTokens: expectedOutput(cls, chosen) + extraOut,
    extraInputTokens: extraIn, extraOutputTokens: extraOut,
    searchFee, rounds, roundsLow: rr.low, roundsHigh: rr.high, openEnded: rr.open,
    factors: found.map((f) => ({ label: f.label, tokens: f.tokens, kind: f.kind, tip: f.tip })),
    habits: opts.session ? factors.habits(opts.session) : [],
    models, byMode, refModel: refId,
    refLabel: core.labelFor ? core.labelFor(refId) : refId,
  };
}

module.exports = { estimate, baseTokens };
