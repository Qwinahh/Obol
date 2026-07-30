"use strict";
/*
 * Obol live tailer — measures the CURRENT session as it happens.
 *
 * Works with both surfaces, because both write Claude Code style .jsonl
 * transcripts with token usage:
 *   - Claude Code (CLI):      ~/.claude/projects/<project>/<session>.jsonl
 *   - Claude app (Cowork):    %APPDATA%/Claude/local-agent-mode-sessions/.../.claude/projects/<project>/<session>.jsonl
 *
 * It tails incrementally (only new bytes since last read), so a 40 MB transcript
 * costs nothing to keep watching. Zero tokens, entirely local.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

function appDataRoots() {
  const home = os.homedir();
  const roots = [
    path.join(home, ".claude", "projects"),
    path.join(home, ".config", "claude", "projects"),
  ];
  const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  roots.push(path.join(appdata, "Claude", "local-agent-mode-sessions"));
  roots.push(path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions"));
  return roots.filter((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

/* Find every .jsonl transcript under the known roots (bounded depth). */
function findTranscripts(dir, depth, out) {
  if (depth < 0) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findTranscripts(p, depth - 1, out);
    else if (e.name.endsWith(".jsonl")) {
      try { const st = fs.statSync(p); out.push({ path: p, mtime: st.mtimeMs, size: st.size }); } catch (e2) {}
    }
  }
  return out;
}

/* The session you are actually working in = the most recently written transcript. */
function newestTranscript() {
  let all = [];
  for (const r of appDataRoots()) findTranscripts(r, 6, all);
  if (!all.length) return null;
  all.sort((a, b) => b.mtime - a.mtime);
  return all[0];
}

function projectName(file) {
  const f = String(file);
  // Claude app (Cowork) sessions live under local-agent-mode-sessions and have
  // machine-generated folder names — label them by surface, not by gibberish.
  if (/local-agent-mode-sessions/.test(f)) return "Claude app";
  const m = f.match(/projects[\/\\]([^\/\\]+)/);
  let raw = m ? m[1] : path.basename(path.dirname(file));
  raw = raw.replace(/-outputs$/, "").replace(/\.jsonl$/, "");
  const parts = raw.split("-").filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : raw;
  return /^[0-9a-f]{8,}$/i.test(last) && parts.length > 1 ? parts[parts.length - 2] : last;
}

const state = new Map(); // path -> { offset, carry, totals }

function blankTotals() { return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, model: "", turns: 0 }; }

/* Read only what is new since last time, and fold it into the running totals. */
function readIncrement(file, size) {
  let st = state.get(file);
  if (!st || size < st.offset) st = { offset: 0, carry: "", totals: blankTotals() };
  if (size === st.offset) { state.set(file, st); return st.totals; }

  let chunk = "";
  try {
    const fd = fs.openSync(file, "r");
    const len = size - st.offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.offset);
    fs.closeSync(fd);
    chunk = buf.toString("utf8");
  } catch (e) { return st.totals; }

  const text = st.carry + chunk;
  const lines = text.split("\n");
  st.carry = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    const m = o && o.message;
    const u = m && m.usage;
    if (!u) continue;
    st.totals.input += u.input_tokens || 0;
    st.totals.output += u.output_tokens || 0;
    st.totals.cacheWrite += u.cache_creation_input_tokens || 0;
    st.totals.cacheRead += u.cache_read_input_tokens || 0;
    st.totals.turns += 1;
    if (m.model) st.totals.model = m.model;
  }
  st.offset = size;
  state.set(file, st);
  return st.totals;
}

/* Current session measurement, or null when nothing is active. */
function measure(core, opts) {
  const maxAgeMs = (opts && opts.maxAgeMs) || 20 * 60 * 1000;
  const t0 = newestTranscript();
  if (!t0) return null;
  const fresh = (Date.now() - t0.mtime) < maxAgeMs;
  const totals = readIncrement(t0.path, t0.size);
  if (!totals.turns) return null;

  const usage = {
    found: true, sessions: 1,
    input: totals.input, output: totals.output, cacheWrite: totals.cacheWrite, cacheRead: totals.cacheRead,
    byModel: [{ model: totals.model || "claude-sonnet", input: totals.input, output: totals.output, cacheWrite: totals.cacheWrite, cacheRead: totals.cacheRead, costUSD: 0 }],
  };
  let savedUSD = 0, savedPct = 0, spendUSD = 0;
  try {
    const pr = core.proof(usage);
    if (pr && pr.cache) { savedUSD = pr.cache.savedUSD || 0; savedPct = pr.cache.savedPct || 0; }
    if (core.costOf) spendUSD = core.costOf({ input: totals.input, output: totals.output, cacheWrite: totals.cacheWrite, cacheRead: totals.cacheRead }, totals.model || "claude-sonnet") || 0;
  } catch (e) {}

  return {
    file: t0.path, project: projectName(t0.path), fresh,
    savedUSD, savedPct, spendUSD, turns: totals.turns,
    model: totals.model, tokens: totals.input + totals.output + totals.cacheWrite + totals.cacheRead,
  };
}

/* Recent sessions you could attach to, newest first. */
function listSessions(limit) {
  let all = [];
  for (const r of appDataRoots()) findTranscripts(r, 6, all);
  all.sort((a, b) => b.mtime - a.mtime);
  return all.slice(0, limit || 12).map((t) => ({
    path: t.path,
    project: projectName(t.path),
    surface: /local-agent-mode-sessions/.test(t.path) ? "Claude app" : "Claude Code",
    mtime: t.mtime,
    sizeKB: Math.round(t.size / 1024),
  }));
}

/* Measure one specific transcript, regardless of age. */
function measureFile(core, file) {
  let st = null;
  try { st = fs.statSync(file); } catch (e) { return null; }
  const totals = readIncrement(file, st.size);
  if (!totals.turns) return null;
  const usage = {
    found: true, sessions: 1,
    input: totals.input, output: totals.output, cacheWrite: totals.cacheWrite, cacheRead: totals.cacheRead,
    byModel: [{ model: totals.model || "claude-sonnet", input: totals.input, output: totals.output, cacheWrite: totals.cacheWrite, cacheRead: totals.cacheRead, costUSD: 0 }],
  };
  let savedUSD = 0, savedPct = 0, spendUSD = 0;
  try {
    const pr = core.proof(usage);
    if (pr && pr.cache) { savedUSD = pr.cache.savedUSD || 0; savedPct = pr.cache.savedPct || 0; }
    if (core.costOf) spendUSD = core.costOf({ input: totals.input, output: totals.output, cacheWrite: totals.cacheWrite, cacheRead: totals.cacheRead }, totals.model || "claude-sonnet") || 0;
  } catch (e) {}
  return {
    file, project: projectName(file), fresh: (Date.now() - st.mtimeMs) < 20 * 60 * 1000,
    savedUSD, savedPct, spendUSD, turns: totals.turns, model: totals.model,
    tokens: totals.input + totals.output + totals.cacheWrite + totals.cacheRead,
  };
}

module.exports = { measure, measureFile, listSessions, newestTranscript, projectName };
