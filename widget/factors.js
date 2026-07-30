"use strict";
/*
 * Obol cost factors — the things that quietly dominate a bill.
 *
 * Most people price a turn as "my prompt + the reply". In practice the money
 * goes on artifacts being rewritten in full, images, search results, file reads
 * and the conversation prefix being re-sent every single turn. This module
 * detects those from the prompt, prices them, and hands back plain-English tips.
 *
 * Everything is local and deterministic. Estimates, clearly labelled as such.
 */

/* Anthropic's own rule of thumb: tokens ~= (width x height) / 750. */
function imageTokens(w, h) { return Math.ceil((w * h) / 750); }
const IMAGE_PRESETS = {
  screenshot: imageTokens(1920, 1080),   // ~2765
  photo: imageTokens(1024, 1024),        // ~1400
  small: imageTokens(640, 480),          // ~410
};

const RX = {
  artifactNew: /\b(make|build|create|write|generate|design|draft)\b[^.]{0,60}\b(artifact|app|page|dashboard|component|game|widget|site|website|chart|diagram|slide|poster|calculator|tool)\b/i,
  artifactEdit: /\b(update|change|tweak|edit|modify|adjust|fix|revise|rework|redo)\b[^.]{0,50}\b(artifact|the (?:app|page|dashboard|component|game|widget|site|chart|diagram|design|code))\b/i,
  image: /\b(this (?:image|screenshot|photo|picture)|attached (?:image|screenshot|photo)|see the (?:image|screenshot)|look at this (?:image|screenshot|photo)|analyse this (?:image|screenshot)|analyze this (?:image|screenshot))\b/i,
  pdf: /\b(pdf|this document|attached document|the deck|slide deck)\b/i,
  search: /\b(search|look up|google|latest|current|news|today|recent|up to date|up-to-date|what.s new|find online)\b/i,
  files: /\b(read|open|check|review|look at|go through)\b[^.]{0,40}\b(file|files|repo|codebase|folder|directory|project)\b/i,
  wholeRepo: /\b(entire|whole|all)\b[^.]{0,20}\b(codebase|repo|repository|project|files)\b/i,
  longOutput: /\b(full|complete|entire|comprehensive|detailed|in depth|in-depth|long)\b[^.]{0,30}\b(report|guide|doc|documentation|essay|article|analysis|plan|spec)\b/i,
  thinking: /\b(think (?:hard|deeply|carefully)|reason through|work through|step by step|step-by-step|carefully consider)\b/i,
};

/*
 * Returns extra token load beyond the prompt itself, plus advice.
 * Each factor: { id, label, tokens, kind: 'input'|'output', tip }
 */
function detect(text, opts) {
  const t = String(text || "");
  const o = opts || {};
  const out = [];

  if (RX.artifactEdit.test(t)) {
    const size = o.artifactTokens || 6000;
    out.push({
      id: "artifact-edit", label: "Artifact rewrite", tokens: size, kind: "output",
      tip: "Updating an artifact re-emits the whole thing. Ask for a targeted edit (\"change only the header\") to avoid paying for a full rewrite each time.",
    });
  } else if (RX.artifactNew.test(t)) {
    out.push({
      id: "artifact-new", label: "Artifact creation", tokens: o.artifactTokens || 5000, kind: "output",
      tip: "Artifacts are large outputs. Ask for a first pass that is deliberately minimal, then refine — cheaper than a maximal first draft you then change.",
    });
  }

  if (RX.image.test(t)) {
    out.push({
      id: "image", label: "Image in context", tokens: IMAGE_PRESETS.screenshot, kind: "input",
      tip: "A full screenshot is ~2,800 tokens. Cropping to the relevant area, or resizing to about 1024px, cuts that by half or more.",
    });
  }
  if (RX.pdf.test(t)) {
    out.push({
      id: "pdf", label: "Document pages", tokens: 12000, kind: "input",
      tip: "PDFs are billed per page as image + text. Paste only the pages that matter instead of the whole file.",
    });
  }
  if (RX.search.test(t)) {
    out.push({
      id: "search", label: "Web results", tokens: 6000, kind: "input",
      tip: "Each search pulls result text into context and it stays there for the rest of the session. Ask one precise question rather than browsing broadly.",
    });
  }
  if (RX.wholeRepo.test(t)) {
    out.push({
      id: "repo", label: "Whole-codebase read", tokens: 60000, kind: "input",
      tip: "Reading a whole repo is the single most expensive habit. Name the 2–3 files that matter — Obol's own logs show this is where most waste comes from.",
    });
  } else if (RX.files.test(t)) {
    out.push({
      id: "files", label: "File reads", tokens: 9000, kind: "input",
      tip: "Each file read stays in context for the rest of the session. Point at specific files rather than asking Claude to explore.",
    });
  }
  if (RX.longOutput.test(t)) {
    out.push({
      id: "long", label: "Long-form output", tokens: 4000, kind: "output",
      tip: "Long documents are pure output cost. Ask for an outline first and expand only the sections you want.",
    });
  }
  if (RX.thinking.test(t)) {
    out.push({
      id: "thinking", label: "Extended reasoning", tokens: 3000, kind: "output",
      tip: "Extended thinking is billed as output. Worth it for genuinely hard problems, wasteful on simple ones.",
    });
  }
  return out;
}

/* Session-level habits worth flagging, from measured usage rather than the prompt. */
function habits(m) {
  const tips = [];
  if (!m || !m.turns) return tips;
  const avg = (m.tokens || 0) / Math.max(1, m.turns);
  if (avg > 150000) tips.push({ id: "context", label: "Very large context", tip: "Your average turn carries " + Math.round(avg / 1000) + "k tokens. Starting a fresh conversation for a new task resets that and is usually the biggest single saving available." });
  else if (avg > 60000) tips.push({ id: "context", label: "Growing context", tip: "Average turn is " + Math.round(avg / 1000) + "k tokens and every turn re-sends it. Start a new chat when you switch topics." });
  if ((m.savedPct || 0) < 50 && m.turns > 3) tips.push({ id: "cache", label: "Low cache hit", tip: "Only " + Math.round(m.savedPct || 0) + "% of your reused context is hitting cache. Keeping the early part of the conversation stable helps caching work." });
  return tips;
}

module.exports = { detect, habits, imageTokens, IMAGE_PRESETS };
