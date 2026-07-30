/*
 * Obol — deterministic prompt classifier (zero tokens, no LLM).
 *
 * Reads the prompt you just typed and scores it on two axes:
 *   complexity  — how much reasoning/capability the task needs
 *   volume      — how much output it is likely to produce
 * ...then recommends a mode and explains why in plain language.
 *
 * Modes
 *   careful     squeeze every token: smallest capable model, terse output, reuse context
 *   balanced    sensible default: right-sized model, normal output
 *   aggressive  hard/high-output work: strongest model, room to think and write
 */

const HEAVY = [
  "architect", "architecture", "design", "refactor", "redesign", "migrate", "migration",
  "debug", "diagnose", "root cause", "why is", "why does", "race condition", "deadlock",
  "optimi", "performance", "algorithm", "concurren", "security", "vulnerab", "threat model",
  "prove", "derive", "reason", "strategy", "trade-off", "tradeoff", "compare", "evaluate",
  "plan", "roadmap", "schema", "data model", "distributed", "scale", "complex",
];
const BULK = [
  "write", "build", "create", "implement", "generate", "draft", "scaffold", "port",
  "document", "docs", "readme", "test suite", "tests for", "boilerplate", "full",
  "add a test", "add tests", "unit test", "endpoint", "component", "function that",
  "entire", "whole", "end to end", "end-to-end", "from scratch", "rewrite",
];
const LIGHT = [
  "rename", "typo", "format", "lint", "bump", "what is", "what's", "where is", "list",
  "show me", "print", "explain briefly", "tldr", "summar", "quick", "small", "tiny",
  "one line", "one-line", "add a comment", "fix the import", "spelling",
];

function count(text, words) {
  let n = 0;
  for (const w of words) if (text.includes(w)) n++;
  return n;
}

export function classify(prompt) {
  const p = String(prompt || "").toLowerCase().trim();
  const words = p ? p.split(/\s+/).length : 0;
  const heavy = count(p, HEAVY);
  const bulk = count(p, BULK);
  const light = count(p, LIGHT);
  const files = (p.match(/[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|php|cs|c|cpp|h|md|json|yml|yaml|html|css|sql)\b/g) || []).length;
  const codeBlock = /```/.test(prompt || "");
  const multiStep = (p.match(/\b(then|after that|also|next|finally|and then)\b/g) || []).length;
  const questions = (p.match(/\?/g) || []).length;

  // complexity: reasoning demand
  let complexity = 0;
  complexity += heavy * 2;
  complexity += multiStep;
  complexity += files > 2 ? 2 : files;
  complexity += words > 120 ? 3 : words > 50 ? 2 : words > 20 ? 1 : 0;
  complexity += codeBlock ? 1 : 0;
  complexity -= light * 2;

  // volume: expected output size
  let volume = 0;
  volume += bulk * 2;
  volume += files > 1 ? 2 : (files ? 1 : 0);
  volume += words > 80 ? 2 : 0;
  volume += /\b(all|every|each|full|entire|whole)\b/.test(p) ? 2 : 0;
  volume -= light * 2;
  volume -= questions > 0 && words < 15 ? 2 : 0;

  const reasons = [];
  let mode;
  if (complexity >= 5 || volume >= 5) {
    mode = "aggressive";
    if (heavy) reasons.push("involves deep reasoning (" + heavy + " complexity signal" + (heavy > 1 ? "s" : "") + ")");
    if (bulk) reasons.push("likely to produce a lot of output");
    if (files > 2) reasons.push("touches several files");
    if (!reasons.length) reasons.push("looks like substantial work");
  } else if (complexity <= 1 && volume <= 1) {
    mode = "careful";
    if (light) reasons.push("small, well-defined ask");
    if (words < 20) reasons.push("short prompt, narrow scope");
    if (!files) reasons.push("no wide file exploration needed");
    if (!reasons.length) reasons.push("low complexity, minimal output expected");
  } else {
    mode = "balanced";
    reasons.push("moderate scope");
    if (files) reasons.push("touches " + files + " file" + (files > 1 ? "s" : ""));
    if (multiStep) reasons.push("has a few steps");
  }

  return { mode, complexity, volume, reasons: reasons.slice(0, 3), words, files };
}

/* Per-mode directives injected as context. These steer behaviour without an LLM call. */
export const DIRECTIVES = {
  careful:
    "[Obol · Careful] Optimise hard for token thrift on this task. Prefer the smallest model that can do the job well and delegate sub-work to cheaper models. Reuse what is already in context instead of re-reading files. Keep prose minimal — answer, don't narrate. Do not restate code you were just shown. Avoid speculative exploration; ask before broad searches. Still fully achieve the goal.",
  balanced:
    "[Obol · Balanced] Right-size effort for this task. Use a capable model but do not over-reach. Reuse context already loaded rather than re-reading. Keep explanation proportional to the change. Explore only what the task needs.",
  aggressive:
    "[Obol · Aggressive] This task warrants full capability. Use the strongest appropriate model and take the room you need to reason and produce complete output. Still avoid redundant file re-reads and needless repetition of context, but do not sacrifice quality or completeness for brevity.",
};
