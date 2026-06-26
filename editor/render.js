"use strict";
// Obol report -> the polished panel design (panel.html) wired to real report data.
// The design is data-driven via window.OBOL (with demo fallbacks). This module
// computes OBOL from the deterministic report and adapts the page for the VS Code
// webview (CSP nonce + embedded fonts). Pure string building - no network, no tokens.

const fs = require("fs");
const path = require("path");

let OBOL_FONTS = "";
try { OBOL_FONTS = require("./fonts"); } catch (e) { OBOL_FONTS = ""; }

let _core = null;
function getCore() {
  if (_core) return _core;
  for (const p of [
    path.join(__dirname, "dist", "index.js"),
    path.join(__dirname, "..", "dist", "index.js"),
  ]) {
    try { _core = require(p); return _core; } catch (e) { /* try next */ }
  }
  return null;
}

const nonce = () => {
  let s = "";
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};

const fmt = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function moneyParts(n) {
  const [whole, cents] = fmt(n).split(".");
  return { whole, cents };
}

const NOTE_FOR = {
  high: "only high-confidence wins",
  med: "high + medium confidence",
  low: "every detected win",
};

function profilesFromReport(report) {
  const c = getCore();
  const ids = (c && c.PROFILE_IDS) || ["careful", "balanced", "aggressive"];
  let raw = null;
  try { raw = c && c.diagnose && report.usage ? c.diagnose(report.usage) : null; } catch (e) {}
  const out = {};
  for (const id of ids) {
    let prof = null, fd = null;
    try { prof = c && c.resolveProfile ? c.resolveProfile(id) : null; } catch (e) {}
    try { fd = raw && c && c.filterDiagnosis && prof ? c.filterDiagnosis(raw, prof) : null; } catch (e) {}
    const finds = (fd ? fd.findings : []).filter((f) => !f.mutedReason && (f.estSaveUSD > 0 || f.severity === "win"));
    const total = fd ? (fd.totalEstSaveUSD || 0) : 0;
    const max = Math.max.apply(null, finds.map((f) => f.estSaveUSD || 0).concat([0.01]));
    const items = finds.map((f) => ({
      nm: f.title,
      id: f.techniqueId + " · " + String(f.confidence || "").toUpperCase(),
      amt: f.estSaveUSD > 0 ? "$" + fmt(f.estSaveUSD) : "—",
      w: Math.max(4, Math.round(((f.estSaveUSD || 0) / max) * 100)),
      p: f.action || f.message || "",
    }));
    out[id] = {
      up: "$" + fmt(total),
      note: NOTE_FOR[prof ? prof.minConfidence : id] || "detected opportunities",
      cta: items.length ? "Review " + items.length + " finding" + (items.length > 1 ? "s" : "") : "Nothing to apply",
      dis: items.length ? 0 : 1,
      finds: items,
    };
  }
  return out;
}

function computeObol(report) {
  const c = getCore();
  const proof = (report.proof && report.proof.cache) || { savedUSD: 0, savedPct: 0 };
  const hist = report.history || null;
  const saved = proof.savedUSD || 0;
  const allTimeNum = hist && hist.totalSavedUSD != null ? hist.totalSavedUSD : saved;
  const mp = moneyParts(allTimeNum);

  let name = "you";
  try { const idn = c && c.loadIdentity ? c.loadIdentity() : null; if (idn && idn.name) name = idn.name; } catch (e) {}

  const fp = report.fingerprint || {};
  const code = ((fp.grade || "") + String(Math.round(fp.score || 0))).replace(/[^A-Za-z0-9]/g, "") || "obol";

  // ambient activity tape derived from the report (cosmetic)
  const tape = [];
  tape.push(["Reading your Claude Code logs", 0]);
  if (report.usage && report.usage.sessions) tape.push(["Measured " + report.usage.sessions + " sessions", 0]);
  if (saved > 0) tape.push(["Caching already saved you", Number(saved.toFixed(2)), 1]);
  ((report.usage && report.usage.byModel) || []).slice(0, 3).forEach((m) => {
    tape.push(["Ran on " + (c && c.shortModel ? c.shortModel(m.model) : m.model), 0]);
  });
  ((report.diagnosis && report.diagnosis.findings) || [])
    .filter((f) => f.estSaveUSD > 0)
    .slice(0, 2)
    .forEach((f) => tape.push([f.title, Number((f.estSaveUSD || 0).toFixed(2)), 1]));
  if (tape.length < 3) tape.push(["Scanning for waste", 0]);

  return {
    activeProfile: (report.profile && report.profile.id) || "balanced",
    profiles: profilesFromReport(report),
    heroAmt: fmt(saved),
    heroSeed: Number(saved.toFixed(2)),
    heroSub:
      "<b>" + Math.round(proof.savedPct || 0) + "%</b> off your reused context, measured against your pricing.",
    tally: {
      allTime: '$' + mp.whole + '<span class="cents">.' + mp.cents + "</span>",
      streak: (hist && hist.streak != null ? hist.streak : 1) + '<span class="u">days</span>',
      runs: hist && hist.runs != null ? hist.runs : 1,
    },
    tape: tape,
    share: { amt: fmt(allTimeNum), link: "obol.dev/w/" + code, name: name },
    eyebrow: "Saved with Obol · all-time",
  };
}

function buildHtml(report, opts) {
  opts = opts || {};
  const n = nonce();
  let html;
  try {
    html = fs.readFileSync(path.join(__dirname, "panel.html"), "utf8");
  } catch (e) {
    return "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif;padding:24px;color:#e8e6f0;background:#0a0a0f'>Obol panel template (panel.html) not found.</body>";
  }

  let OBOL = {};
  try { OBOL = computeObol(report); } catch (e) { OBOL = {}; }

  // drop CDN font links (blocked by webview CSP) - CSS already has system fallbacks
  html = html
    .replace(/<link rel="preconnect"[^>]*>/g, "")
    .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis[^"]*"\s*\/?>(?:<\/link>)?/g, "");

  // prefer the embedded Obol fonts
  html = html
    .replace("--sans:'Poppins'", "--sans:'Obol Sans','Poppins'")
    .replace("--mono:'JetBrains Mono'", "--mono:'Obol Mono','JetBrains Mono'");

  // inject CSP + embedded fonts into <head>
  const headInject =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; ' +
    "script-src 'nonce-" + n + "'; font-src data:; img-src data: blob:;\" />\n" +
    '<style nonce="' + n + '">' + OBOL_FONTS + "</style>";
  html = html.replace("</head>", headInject + "\n</head>");

  // every <script> needs the nonce under the webview CSP
  html = html.replace(/<script>/g, '<script nonce="' + n + '">');

  // inject real data just before the first (main) script
  const dataScript =
    '<script nonce="' + n + '">window.OBOL=' + JSON.stringify(OBOL) + ";</script>\n";
  html = html.replace('<script nonce="' + n + '">', dataScript + '<script nonce="' + n + '">');

  return html;
}

module.exports = { buildHtml, computeObol };
