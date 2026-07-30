#!/usr/bin/env node
/*
 * Obol router — UserPromptSubmit hook.
 *
 * Runs the moment you send a prompt in Claude Code. Zero tokens: it classifies
 * the prompt with local heuristics, applies your chosen optimisation mode as a
 * directive, and publishes live state for the Obol widget. It never prints a
 * wall of text into your session.
 *
 * State files (all local, under ~/.obol):
 *   mode.json     { mode }                      <- written by the widget (your pick)
 *   session.json  { sessionId, cwd, project, mode, recommended, reasons, turns, ts }
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { classify, DIRECTIVES } from "./classify.mjs";

const DIR = join(homedir(), ".obol");
const MODE_FILE = join(DIR, "mode.json");
const SESSION_FILE = join(DIR, "session.json");
const MODES = ["careful", "balanced", "aggressive"];

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return fallback; }
}
function writeJson(p, v) {
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(p, JSON.stringify(v)); } catch (e) {}
}
function readStdin() {
  try { return readFileSync(0, "utf8"); } catch (e) { return ""; }
}

const input = readJson0(readStdin());
function readJson0(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

const prompt = String(input.prompt || "");
const sessionId = String(input.session_id || "");
const cwd = String(input.cwd || process.cwd() || "");
const project = basename(cwd) || "session";

// Escape hatch: prefix a prompt with ~ to skip Obol entirely for that turn.
if (prompt.trim().startsWith("~")) process.exit(0);

const rec = classify(prompt);

// The widget owns the choice. "auto" (or unset) means follow the recommendation.
const saved = readJson(MODE_FILE, { mode: "auto" });
const chosen = MODES.includes(saved.mode) ? saved.mode : rec.mode;

// Publish live state so the widget can show mode, project, and reasoning.
const prev = readJson(SESSION_FILE, {});
writeJson(SESSION_FILE, {
  sessionId,
  cwd,
  project,
  mode: chosen,
  auto: !MODES.includes(saved.mode),
  recommended: rec.mode,
  reasons: rec.reasons,
  complexity: rec.complexity,
  volume: rec.volume,
  turns: (prev.sessionId === sessionId ? (prev.turns || 0) : 0) + 1,
  active: true,
  ts: Date.now(),
});

// Steer the turn. additionalContext is injected for Claude, not shown as chat noise.
const directive = DIRECTIVES[chosen] || DIRECTIVES.balanced;
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: directive,
  },
}));
process.exit(0);
