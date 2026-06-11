"use strict";
// Obol report → self-contained HTML for the VS Code webview.
// Same numbers as the CLI (both build from core.buildReport), re-rendered for a
// rich in-editor panel: the "satisfying UI" with a dark card aesthetic, accent
// bars, a fingerprint gauge, the cache receipt, findings, and the guard plan.
// Pure string building — no network, no tokens.

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const usd = (n) => {
  const v = Number(n) || 0;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const gcost = (n) => (n <= 0 ? "$0.00" : n < 0.01 ? "<$0.01" : usd(n));
const tok = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "k";
  return String(Math.round(v));
};
const pct = (n) => Math.round(Number(n) || 0) + "%";
const nonce = () => { let s = ""; const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; for (let i = 0; i < 24; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };

/* ---------- panel builders ---------- */

function noLogs() {
  return `
  <section class="card empty">
    <h2>No Claude Code logs found</h2>
    <p class="dim">Obol looks in your <code>~/.claude/projects</code> sessions. Nothing there yet, or logs live elsewhere.</p>
    <div class="row">
      <button class="btn primary" data-cmd="demo">See the demo report</button>
      <button class="btn" data-cmd="analyze">Re-scan my logs</button>
    </div>
  </section>`;
}

function usageCard(r) {
  const u = r.usage;
  const span = u.firstDate && u.lastDate ? `${esc(u.firstDate)} → ${esc(u.lastDate)}` : "—";
  const demoTag = u.source === "demo://synthetic-usage" ? `<span class="tag magenta">demo data</span>` : "";
  // composition
  const total = (u.input + u.output + u.cacheWrite + u.cacheRead) || 1;
  const segs = [
    { label: "cache read", v: u.cacheRead, cls: "cyan" },
    { label: "cache write", v: u.cacheWrite, cls: "magenta" },
    { label: "input", v: u.input, cls: "green" },
    { label: "output", v: u.output, cls: "amber" },
  ];
  const barSegs = segs.map((s) => `<span class="seg ${s.cls}" style="width:${(s.v / total) * 100}%" title="${s.label} ${pct((s.v / total) * 100)}"></span>`).join("");
  const legend = segs.map((s) => `<span class="leg"><i class="dot ${s.cls}"></i>${s.label} ${pct((s.v / total) * 100)}</span>`).join("");

  // daily sparkline
  let trend = "";
  if (u.byDay && u.byDay.length > 1) {
    const max = Math.max.apply(null, u.byDay.map((d) => d.costUSD)) || 1;
    const peak = u.byDay.reduce((m, d) => (d.costUSD > m.costUSD ? d : m), u.byDay[0]);
    const bars = u.byDay.map((d) => `<span class="spark" style="height:${Math.max(8, (d.costUSD / max) * 100)}%" title="${esc(d.date)} ${usd(d.costUSD)}"></span>`).join("");
    trend = `<div class="trend"><div class="sparkline">${bars}</div><div class="dim small">daily spend · peak ${usd(peak.costUSD)} on ${esc(peak.date)}</div></div>`;
  }

  // top sessions
  let sessions = "";
  if (u.bySession && u.bySession.length > 1) {
    const max = u.bySession[0].costUSD || 1;
    const rows = u.bySession.slice(0, 4).map((s) => {
      const id = (s.id.length > 8 ? s.id.slice(0, 8) : s.id);
      const reads = s.repeatedReads && s.repeatedReads.length ? `<span class="amber"> ⟳${s.repeatedReads.length}</span>` : "";
      return `<div class="srow">
        <code class="sid">${esc(id)}</code>
        <span class="track"><span class="fill cyan" style="width:${(s.costUSD / max) * 100}%"></span></span>
        <span class="scost">${usd(s.costUSD)}</span>
        <span class="dim small">${s.turns}t · ${tok(s.avgCachePrefix)} prefix${reads}</span>
      </div>`;
    }).join("");
    sessions = `<div class="sessions"><div class="dim small label">Top sessions — where spend concentrates</div>${rows}</div>`;
  }

  return `
  <section class="card">
    <div class="topline">
      <div class="stat"><b>${usd(u.totalCostUSD)}</b><span class="dim">spent</span></div>
      <div class="stat"><b>${tok(u.totalTokens)}</b><span class="dim">tokens</span></div>
      <div class="stat"><b>${u.sessions}</b><span class="dim">sessions</span></div>
      <div class="span dim">${span} ${demoTag}</div>
    </div>
    <div class="dim small label">where your tokens go</div>
    <div class="stacked">${barSegs}</div>
    <div class="legend">${legend}</div>
    ${trend}
    ${sessions}
  </section>`;
}

function fingerprintCard(r) {
  const f = r.fingerprint;
  const cls = f.score >= 80 ? "green" : f.score >= 55 ? "amber" : "red";
  return `
  <section class="card fp">
    <div class="fp-head">
      <div>
        <div class="dim small label">fingerprint</div>
        <div class="fp-traits ${cls}">${esc(f.traits.join(" · "))}</div>
      </div>
      <div class="fp-score ${cls}"><b>${f.score}</b><span class="dim">/100</span><span class="grade ${cls}">${esc(f.grade)}</span></div>
    </div>
    <span class="track tall"><span class="fill ${cls}" style="width:${f.score}%"></span></span>
    <div class="dim small share">share me ↑</div>
  </section>`;
}

function receiptCard(r) {
  if (!r.proof || !r.proof.hasCacheReceipt) return "";
  const c = r.proof.cache;
  return `
  <section class="card receipt">
    <div class="rhead"><span class="badge green">✓ RECEIPT</span><span class="dim">measured from your logs — not an estimate</span></div>
    <div class="dim">caching has already saved you</div>
    <div class="bignum green">${usd(c.savedUSD)} <span class="dim small">${pct(c.savedPct)} off your reused context</span></div>
    <div class="dim small">would've cost ${usd(c.hypotheticalNoCacheUSD)} · actually cost ${usd(c.actualUSD)} · ${tok(c.cachedTokens)} reused tokens</div>
  </section>`;
}

function findingsCard(r) {
  const d = r.diagnosis;
  if (!d.findings || !d.findings.length) return "";
  const head = d.alreadyEfficient
    ? `<div class="badge green big">✓ Already running efficiently.</div>`
    : `<div class="savings"><span class="dim">Estimated savings</span> <b class="green">up to ${usd(d.totalEstSaveUSD)}</b> <span class="dim small">(~${pct(d.totalEstSavePct)} of ${usd(r.usage.totalCostUSD)})</span></div>
       <div class="dim small">estimates — the receipt above proves what caching already saved; the Quality Guard protects these.</div>`;
  const max = Math.max.apply(null, d.findings.map((f) => f.estSaveUSD).concat([0.01]));
  const items = d.findings.map((f) => {
    const mark = f.severity === "win" ? `<span class="amber">▲</span>` : f.severity === "ok" ? `<span class="green">✓</span>` : `<span class="dim">•</span>`;
    const tag = f.autoApply === "green" ? `<span class="tag green">auto</span>` : f.autoApply === "amber" ? `<span class="tag amber">review</span>` : "";
    const save = f.estSaveUSD > 0 ? `<span class="green save">${usd(f.estSaveUSD)}</span>` : `<span class="dim save">—</span>`;
    const bar = f.estSaveUSD > 0 ? `<span class="track"><span class="fill green" style="width:${(f.estSaveUSD / max) * 100}%"></span></span>` : "";
    return `<div class="finding">
      <div class="frow">${mark} <b>${esc(f.title)}</b> <span class="dim small">${esc(f.techniqueId)} · ${esc(f.confidence)}</span> ${tag} ${save}</div>
      ${bar}
      <div class="fmsg">${esc(f.message)}</div>
      <div class="dim small">${esc(f.action)}</div>
    </div>`;
  }).join("");
  return `<section class="card">${head}<div class="findings">${items}</div></section>`;
}

function applyCard(r) {
  const p = r.apply;
  if (!p.actions || !p.actions.length) return "";
  const rows = p.actions.map((a) => {
    const isGreen = a.tier === "green";
    const mark = isGreen ? `<span class="green">●</span>` : `<span class="amber">○</span>`;
    const tag = isGreen ? `<span class="tag green">auto</span>` : `<span class="tag amber">review</span>`;
    return `<div class="arow">
      <div>${mark} <b>${esc(a.title)}</b> <span class="dim small">${esc(a.techniqueId)} · ${esc(a.kind)}</span> ${tag}</div>
      <div class="asum">${esc(a.summary)}</div>
      <div class="dim small mono">${esc((a.patch || "").split("\n")[0])}${(a.patch || "").includes("\n") ? " …" : ""}</div>
    </div>`;
  }).join("");
  const btn = p.green.length ? `<button class="btn primary" data-cmd="apply">Apply ${p.green.length} safe fix${p.green.length > 1 ? "es" : ""} (reversible)</button>` : "";
  return `
  <section class="card">
    <div class="chead"><b>Apply</b> <span class="green">${p.green.length} ready</span> <span class="dim">/</span> <span class="amber">${p.amber.length} to review</span> <span class="dim small">— green is safe + reversible; amber waits for you</span></div>
    <div class="applylist">${rows}</div>
    <div class="row">${btn}</div>
  </section>`;
}

function nextCard(r) {
  if (!r.nextSteps || !r.nextSteps.length) return "";
  const rows = r.nextSteps.map((s) => {
    const cls = s.tier === "green" ? "green" : "amber";
    const save = s.estSaveUSD > 0 ? `<span class="green">up to ${usd(s.estSaveUSD)}</span>` : `<span class="dim">—</span>`;
    return `<div class="nrow">
      <div><b class="${cls}">${s.rank}. ${esc(s.title)}</b> <span class="dim small">${esc(s.effort)}</span> ${save}</div>
      <div class="dim small">${esc(s.detail)}</div>
    </div>`;
  }).join("");
  return `<section class="card"><div class="chead"><b>Do this next</b> <span class="dim small">— biggest, easiest wins first</span></div><div class="nextlist">${rows}</div></section>`;
}

function guardCard(r) {
  const g = r.guard;
  if (!g.probes || !g.probes.length) return "";
  const safe = g.safe.map((p) => `<div class="grow"><span class="green">✓</span> <b>${esc(p.title)}</b> <span class="dim small">${esc(p.techniqueId)}</span> <span class="green">proven safe · $0</span><div class="dim small">${esc(p.rationale)}</div></div>`).join("");
  const replay = g.replay.map((p) => `<div class="grow"><span class="amber">○</span> <b>${esc(p.title)}</b> <span class="dim small">${esc(p.techniqueId)}</span> <span class="dim">needs a canary check · est <span class="amber">${gcost(p.estCostUSD)}</span></span><div class="dim small">${esc(p.rationale)}</div></div>`).join("");
  const manual = g.manual.map((p) => `<div class="grow"><span class="dim">·</span> <b>${esc(p.title)}</b> <span class="dim small">${esc(p.techniqueId)} — ${esc(p.rationale)}</span></div>`).join("");
  let foot = "";
  if (g.replay.length) {
    foot = `<div class="dim small foot">The guard's live check is the one feature that spends tokens — it's off by default. Set <code>ANTHROPIC_API_KEY</code> and run <code>obol --guard</code> (~${gcost(g.estCostUSD)}). Everything above stayed $0. <button class="btn link" data-cmd="guardHint">how?</button></div>`;
  }
  return `<section class="card"><div class="chead"><b>Quality Guard</b> <span class="dim small">— prove a fix didn't make answers worse</span></div>${safe}${replay}${manual}${foot}</section>`;
}

/* ---------- document ---------- */

function buildHtml(report, opts) {
  opts = opts || {};
  const n = nonce();
  const csp = opts.cspSource || "";
  const body = !report.found
    ? noLogs()
    : [usageCard, fingerprintCard, receiptCard, findingsCard, applyCard, nextCard, guardCard]
        .map((fn) => fn(report)).join("\n");

  const toolbar = `
    <div class="toolbar">
      <div class="brand"><span class="mark">◎</span> obol <span class="dim ver">v${esc(report.version)}</span></div>
      <div class="actions">
        <button class="btn" data-cmd="analyze">Analyze my logs</button>
        <button class="btn" data-cmd="demo">Demo</button>
      </div>
    </div>
    <div class="tagline dim">measure · diagnose · cut your token spend — local, deterministic, free</div>`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';" />
<style>
:root{
  --bg:#0e1116; --card:#151a21; --line:#222a34; --fg:#dfe6ee; --dim:#8b97a7;
  --cyan:#3fd0e0; --magenta:#c98bdb; --green:#5fd38d; --amber:#e7b95a; --red:#e07a6b;
}
*{box-sizing:border-box}
body{margin:0;padding:18px 20px 40px;background:var(--bg);color:var(--fg);
  font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dim{color:var(--dim)} .small{font-size:11.5px} .mono{font-family:inherit}
.green{color:var(--green)} .amber{color:var(--amber)} .cyan{color:var(--cyan)}
.magenta{color:var(--magenta)} .red{color:var(--red)}
.toolbar{display:flex;align-items:center;justify-content:space-between}
.brand{font-size:18px;font-weight:700;letter-spacing:.5px}
.brand .mark{color:var(--cyan)} .brand .ver{font-size:12px;font-weight:400;margin-left:6px}
.tagline{margin:2px 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;
  padding:16px 18px;margin:0 0 14px}
.card.empty{text-align:center;padding:36px}
.label{text-transform:lowercase;letter-spacing:.4px;margin-bottom:6px}
.topline{display:flex;gap:24px;align-items:baseline;flex-wrap:wrap;margin-bottom:14px}
.stat b{font-size:22px;margin-right:6px} .span{margin-left:auto}
.tag{font-size:10.5px;padding:1px 7px;border-radius:999px;border:1px solid currentColor;margin-left:4px}
.tag.green{color:var(--green)} .tag.amber{color:var(--amber)} .tag.magenta{color:var(--magenta)}
.stacked{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#0a0d11}
.seg{display:block;height:100%}
.seg.cyan{background:var(--cyan)} .seg.magenta{background:var(--magenta)}
.seg.green{background:var(--green)} .seg.amber{background:var(--amber)}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;color:var(--dim);font-size:11.5px}
.dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:middle}
.dot.cyan{background:var(--cyan)} .dot.magenta{background:var(--magenta)}
.dot.green{background:var(--green)} .dot.amber{background:var(--amber)}
.trend{margin-top:14px}
.sparkline{display:flex;align-items:flex-end;gap:3px;height:42px}
.spark{flex:1;background:linear-gradient(var(--cyan),#1d6f7a);border-radius:2px;min-height:8%}
.sessions{margin-top:16px}
.srow{display:grid;grid-template-columns:74px 1fr auto auto;gap:10px;align-items:center;margin:5px 0}
.sid{color:var(--dim)} .scost{font-weight:700}
.track{display:block;height:8px;border-radius:5px;background:#0a0d11;overflow:hidden}
.track.tall{height:12px;margin:8px 0 4px}
.fill{display:block;height:100%;border-radius:5px}
.fill.cyan{background:var(--cyan)} .fill.green{background:var(--green)}
.fill.amber{background:var(--amber)} .fill.red{background:var(--red)}
.fp-head{display:flex;justify-content:space-between;align-items:flex-end}
.fp-traits{font-size:16px;font-weight:700}
.fp-score b{font-size:26px} .grade{margin-left:8px;font-weight:700}
.share{text-align:right;margin-top:-2px}
.receipt .rhead{display:flex;gap:10px;align-items:center;margin-bottom:6px}
.badge{font-weight:700} .badge.big{font-size:15px} .badge.green{color:var(--green)}
.bignum{font-size:26px;font-weight:700;margin:2px 0}
.savings b{font-size:18px} .savings{margin-bottom:2px}
.chead{margin-bottom:12px}
.finding{padding:10px 0;border-top:1px solid var(--line)}
.finding:first-child{border-top:0}
.frow{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.frow .save{margin-left:auto;font-weight:700}
.finding .track{margin:7px 0 6px} .fmsg{margin:2px 0}
.arow,.nrow,.grow{padding:9px 0;border-top:1px solid var(--line)}
.arow:first-child,.nrow:first-child,.grow:first-child{border-top:0}
.asum{margin:3px 0}
.row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.btn{background:#1c2530;color:var(--fg);border:1px solid var(--line);
  border-radius:8px;padding:7px 14px;font:inherit;cursor:pointer}
.btn:hover{border-color:var(--cyan)}
.btn.primary{background:var(--green);color:#06210f;border-color:var(--green);font-weight:700}
.btn.primary:hover{filter:brightness(1.08)}
.btn.link{background:none;border:0;color:var(--cyan);padding:0 4px;text-decoration:underline}
.actions{display:flex;gap:8px}
.foot{margin-top:12px;line-height:1.7}
code{background:#0a0d11;padding:1px 5px;border-radius:4px;color:var(--cyan)}
</style></head>
<body>
${toolbar}
${body}
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) vscode.postMessage({ cmd: b.getAttribute('data-cmd') });
  });
</script>
</body></html>`;
}

module.exports = { buildHtml };
