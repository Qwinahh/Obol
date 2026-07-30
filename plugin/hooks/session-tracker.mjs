#!/usr/bin/env node
/*
 * Obol session tracker — Stop hook.
 *
 * After each turn completes, reads THIS session's transcript, measures the cache
 * savings for it with the deterministic proof engine, and publishes the running
 * total so the Obol widget can show savings rising live. Zero tokens, local only.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(homedir(), ".obol");
const SESSION_FILE = join(DIR, "session.json");
const LEDGER_FILE = join(DIR, "ledger.json");

function readJson(p, fb) { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return fb; } }
function writeJson(p, v) { try { mkdirSync(DIR, { recursive: true }); writeFileSync(p, JSON.stringify(v)); } catch (e) {} }

let core = null;
for (const p of [join(HERE, "..", "dist", "index.js"), join(HERE, "..", "..", "dist", "index.js")]) {
  try { core = require(p); break; } catch (e) {}
}

const input = (() => { try { return JSON.parse(readFileSync(0, "utf8")); } catch (e) { return {}; } })();
const transcript = String(input.transcript_path || "");
const sessionId = String(input.session_id || "");

/* Sum this session's token counts straight from its transcript. */
function tally(file) {
  const t = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, model: "" };
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch (e) { return t; }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    const m = o && o.message;
    const u = m && m.usage;
    if (!u) continue;
    t.input += u.input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
    if (m.model) t.model = m.model;
  }
  return t;
}

const t = tally(transcript);
let savedUSD = 0, savedPct = 0, spendUSD = 0;
try {
  if (core && core.proof) {
    const usage = {
      found: true, sessions: 1, input: t.input, output: t.output,
      cacheWrite: t.cacheWrite, cacheRead: t.cacheRead,
      byModel: [{ model: t.model || "claude-sonnet", input: t.input, output: t.output, cacheWrite: t.cacheWrite, cacheRead: t.cacheRead, costUSD: 0 }],
    };
    const pr = core.proof(usage);
    if (pr && pr.cache) { savedUSD = pr.cache.savedUSD || 0; savedPct = pr.cache.savedPct || 0; }
    if (core.costOf) spendUSD = core.costOf({ input: t.input, output: t.output, cacheWrite: t.cacheWrite, cacheRead: t.cacheRead }, t.model || "claude-sonnet") || 0;
  }
} catch (e) {}

const s = readJson(SESSION_FILE, {});
const fresh = s.sessionId !== sessionId;
writeJson(SESSION_FILE, {
  ...s,
  sessionId: sessionId || s.sessionId,
  active: true,
  savedUSD, savedPct, spendUSD,
  tokens: t.input + t.output + t.cacheWrite + t.cacheRead,
  model: t.model || s.model || "",
  ts: Date.now(),
});

/* All-time ledger: credit only what Obol measured, per session, no double counting. */
const L = readJson(LEDGER_FILE, { allTime: 0, sessions: {} });
if (!L.sessions) L.sessions = {};
if (sessionId) {
  const prevForSession = L.sessions[sessionId] || 0;
  const delta = savedUSD - prevForSession;
  if (delta > 0) { L.allTime = (L.allTime || 0) + delta; L.sessions[sessionId] = savedUSD; writeJson(LEDGER_FILE, L); }
}
process.exit(0);
