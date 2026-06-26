"use strict";
/*
 * panel.js — build the Obol visual card HTML for the MCP App iframe.
 * Same deterministic data the VS Code webview uses (computeObol), injected into
 * card.html as window.OBOL, plus the MCP App bridge that performs the
 * iframe<->host handshake. Pure string building, zero network.
 */
const fs = require("fs");
const path = require("path");

let _core = null;
function getCore() {
  if (_core) return _core;
  for (const p of [path.join(__dirname, "..", "dist", "index.js"), path.join(__dirname, "dist", "index.js")]) {
    try { _core = require(p); return _core; } catch (e) {}
  }
  return null;
}

const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function moneyParts(n) { const [whole, cents] = fmt(n).split("."); return { whole, cents }; }

const NOTE_FOR = { high: "only high-confidence wins", med: "high + medium confidence", low: "every detected win" };

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

  // "this session" = the most recent Claude Code session's measured cache savings
  // (distinct from the all-time ledger). Falls back to the whole-run figure.
  let sessSaved = saved, sessPct = proof.savedPct || 0;
  try {
    const sessions = (report.usage && report.usage.bySession) || [];
    if (sessions.length && c && c.proof) {
      const latest = sessions.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      const one = {
        found: true, sessions: 1,
        input: latest.input || 0, output: latest.output || 0, cacheWrite: latest.cacheWrite || 0, cacheRead: latest.cacheRead || 0,
        byModel: [{ model: latest.model, input: latest.input || 0, output: latest.output || 0, cacheWrite: latest.cacheWrite || 0, cacheRead: latest.cacheRead || 0, costUSD: latest.costUSD || 0 }],
      };
      const pr = c.proof(one);
      if (pr && pr.cache) { sessSaved = pr.cache.savedUSD || 0; sessPct = pr.cache.savedPct || 0; }
    }
  } catch (e) { /* fall back to whole-run figure */ }

  // all-time = total measured cache savings across all of the user's logs (the
  // showcase figure: 0 for brand-new users, grows automatically with use).
  const allTimeNum = saved;
  // readable label for the most recent session (shown as "Latest · <name>")
  let latestFile = "";
  try {
    const ssx = (report.usage && report.usage.bySession) || [];
    if (ssx.length) {
      const lt = ssx.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      const f = String((lt && lt.file) || "");
      const m = f.match(/projects[\/\\]([^\/\\]+)/);
      latestFile = m ? m[1] : (f.split(/[\/\\]/).pop() || "").replace(/\.jsonl$/, "");
    }
  } catch (e) {}
  const mp = moneyParts(allTimeNum);

  let name = "you";
  try { const idn = c && c.loadIdentity ? c.loadIdentity() : null; if (idn && idn.name) name = idn.name; } catch (e) {}
  const fp = report.fingerprint || {};
  const code = ((fp.grade || "") + String(Math.round(fp.score || 0))).replace(/[^A-Za-z0-9]/g, "") || "obol";

  const tape = [];
  tape.push(["Reading your Claude Code logs", 0]);
  if (report.usage && report.usage.sessions) tape.push(["Measured " + report.usage.sessions + " sessions", 0]);
  if (saved > 0) tape.push(["Caching already saved you", Number(saved.toFixed(2)), 1]);
  ((report.usage && report.usage.byModel) || []).slice(0, 3).forEach((m) => {
    tape.push(["Ran on " + (c && c.shortModel ? c.shortModel(m.model) : m.model), 0]);
  });
  ((report.diagnosis && report.diagnosis.findings) || [])
    .filter((f) => f.estSaveUSD > 0).slice(0, 2)
    .forEach((f) => tape.push([f.title, Number((f.estSaveUSD || 0).toFixed(2)), 1]));
  if (tape.length < 3) tape.push(["Scanning for waste", 0]);

  const fpc = report.fingerprint || {};
  const u = report.usage || {};
  const topModel = ((u.byModel || []).slice().sort((a, b) => (b.costUSD || 0) - (a.costUSD || 0))[0]) || null;
  const modelName = topModel ? (c && c.shortModel ? c.shortModel(topModel.model) : topModel.model) : "—";

  return {
    activeProfile: (report.profile && report.profile.id) || "balanced",
    profiles: profilesFromReport(report),
    grade: fpc.grade || "",
    score: Math.round(fpc.score || 0),
    connected: !!(report && report.found),
    latestFile: latestFile,
    measured: fmt(sessSaved),
    savedPct: Math.round(sessPct),
    sessions: u.sessions || 0,
    spend: fmt(u.totalCostUSD),
    model: modelName,
    allTime: fmt(allTimeNum),
    heroAmt: fmt(sessSaved),
    heroSeed: Number(sessSaved.toFixed(2)),
    tally: {
      allTime: "$" + mp.whole + '<span class="cents">.' + mp.cents + "</span>",
      streak: (hist && hist.currentStreak != null ? hist.currentStreak : 1) + '<span class="u">days</span>',
      runs: hist && hist.runs != null ? hist.runs : 1,
    },
    tape: tape,
    share: { amt: fmt(allTimeNum), link: "obol.dev/w/" + code, name: name },
    eyebrow: "Saved with Obol · all-time",
  };
}

let _bridge = null;
function bridgeJs() {
  if (_bridge != null) return _bridge;
  try { _bridge = fs.readFileSync(path.join(__dirname, "bridge.bundle.js"), "utf8"); }
  catch (e) { _bridge = ""; }
  return _bridge;
}

// Build the iframe HTML: real data embedded as window.OBOL + the host handshake bridge.
function buildPanelHtml(report) {
  let html;
  try { html = fs.readFileSync(path.join(__dirname, "card.html"), "utf8"); }
  catch (e) { return { html: "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif;padding:24px'>Obol card template missing.</body>", obol: {} }; }

  const obol = computeObol(report);

  // inject real data just before the first script. FUNCTION replacements avoid
  // String.replace special patterns ($&, $`, $') in the JSON / bridge bundle.
  const data = "<script>window.OBOL=" + JSON.stringify(obol).replace(/<\//g, "<\\/") + ";</script>\n";
  html = html.replace("<script>", function () { return data + "<script>"; });

  const bridge = bridgeJs();
  if (bridge) html = html.replace("</body>", function () { return "<script>\n" + bridge + "\n</script>\n</body>"; });

  return { html: html, obol: obol };
}

module.exports = { computeObol, buildPanelHtml };
