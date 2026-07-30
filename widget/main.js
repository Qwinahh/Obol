"use strict";
/*
 * Obol Live — a small always-on-top desktop widget that shows the Obol card and
 * refreshes as you work. It reuses the exact card (../mcp/card.html) and the
 * deterministic core (../dist). Zero tokens, zero network (fonts excepted).
 *
 * It refreshes: on launch, on an interval, when your Claude Code logs change,
 * and when the Claude extension signals a /analyze (~/.obol/live-refresh).
 */
const { app, BrowserWindow, ipcMain, screen, dialog, clipboard, nativeImage } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Resolve local (packaged/self-contained) copies first, fall back to the dev repo layout.
function pick(localRel, devRel) {
  const lp = path.join(__dirname, localRel);
  return fs.existsSync(lp) ? lp : path.join(__dirname, "..", devRel);
}
const core = require(pick("dist/index.js", "dist/index.js"));
const panel = require(pick("panel.js", "mcp/panel.js"));
const VERSION = (() => { try { return require(pick("dist-version.json", "package.json")).version || "0.0.1"; } catch (e) { return "0.0.1"; } })();
const CARD = pick("card.html", "mcp/card.html");
const SHARE = (() => { try { return fs.readFileSync(pick("share.html", "widget/share.html"), "utf8"); } catch (e) { return ""; } })();
const tail = (() => { try { return require(pick("tail.js", "widget/tail.js")); } catch (e) { return null; } })();
const est = (() => { try { return require(pick("estimate.js", "widget/estimate.js")); } catch (e) { return null; } })();
const cls = (() => { try { return require(pick("classify.js", "mcp/classify.js")); } catch (e) { return null; } })();
const PLAN = (() => { try { return fs.readFileSync(pick("plan.html", "widget/plan.html"), "utf8"); } catch (e) { return ""; } })();

const fmt = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LEDGER = path.join(os.homedir(), ".obol", "ledger.json");
function readLedger() { try { return JSON.parse(fs.readFileSync(LEDGER, "utf8")); } catch (e) { return { allTime: 0, seen: {}, init: false }; } }
function writeLedger(L) { try { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.writeFileSync(LEDGER, JSON.stringify(L)); } catch (e) {} }
function sessionSaved(s) {
  try {
    const pr = core.proof({ found: true, sessions: 1, input: s.input || 0, output: s.output || 0, cacheWrite: s.cacheWrite || 0, cacheRead: s.cacheRead || 0,
      byModel: [{ model: s.model, input: s.input || 0, output: s.output || 0, cacheWrite: s.cacheWrite || 0, cacheRead: s.cacheRead || 0, costUSD: s.costUSD || 0 }] });
    return (pr && pr.cache && pr.cache.savedUSD) || 0;
  } catch (e) { return 0; }
}
// Credit savings from sessions that appear AFTER Obol was first launched. The first
// run baselines (marks existing sessions seen, credits nothing) so the showcase
// starts at $0 for everyone and only grows from new usage.
function updateLedger(usage) {
  const L = readLedger();
  if (!L.seen) L.seen = {};
  const sessions = (usage && usage.bySession) || [];
  let dirty = false;
  if (!L.init) { for (const s of sessions) { if (!L.seen[s.id]) { L.seen[s.id] = true; } } L.init = true; L.allTime = L.allTime || 0; dirty = true; }
  else { for (const s of sessions) { if (!L.seen[s.id]) { L.allTime = (L.allTime || 0) + sessionSaved(s); L.seen[s.id] = true; dirty = true; } } }
  if (dirty) writeLedger(L);
  return L.allTime || 0;
}
const SESSION_FILE = path.join(os.homedir(), ".obol", "session.json");
const MODE_FILE = path.join(os.homedir(), ".obol", "mode.json");
function readSession() { try { return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch (e) { return null; } }
// A session counts as live if the hooks touched it recently (12 min window).
function liveSession() {
  const s = readSession();
  if (!s || !s.ts) return null;
  return (Date.now() - s.ts) < 12 * 60 * 1000 ? s : null;
}
function ledgerAllTime() { try { return JSON.parse(fs.readFileSync(LEDGER, "utf8")).allTime || 0; } catch (e) { return 0; } }

function liveUsage() { try { const u = core.readUsage(); return (u && u.found) ? { u, live: true } : { u: core.demoUsage(), live: false }; } catch (e) { return { u: core.demoUsage(), live: false }; } }

// Neutral: what the widget shows on launch / before any analyze this run.
function computeNeutral() {
  try {
    return { neutral: true, connected: false, measured: "0.00", savedPct: 0, allTime: fmt(ledgerAllTime()),
      sessions: 0, spend: "0.00", model: "", latestFile: "", score: null,
      activeProfile: readMode(), recommended: null, reasons: [],
      profiles: { careful: { finds: [] }, balanced: { finds: [] }, aggressive: { finds: [] } } };
  } catch (e) { return { neutral: true, measured: "0.00", allTime: "0.00" }; }
}
function readMode() { try { const m = JSON.parse(fs.readFileSync(MODE_FILE, "utf8")).mode; return ["careful","balanced","aggressive"].includes(m) ? m : "auto"; } catch (e) { return "auto"; } }
function writeMode(mode) { try { fs.mkdirSync(path.dirname(MODE_FILE), { recursive: true }); fs.writeFileSync(MODE_FILE, JSON.stringify({ mode })); } catch (e) {} }

// Live: driven by the Claude Code hooks for the CURRENT session.
// Measures whatever session you are actually working in right now, on either
// surface, by tailing its transcript. This is what makes the number rise live.
function computeTailed() {
  if (!tail) return null;
  let m = null;
  try { m = tail.measure(core, { maxAgeMs: 20 * 60 * 1000 }); } catch (e) { return null; }
  if (!m || !m.fresh) return null;
  const sess = liveSession();           // hook state, when Claude Code is driving
  const ledger = creditLedger(m.file, m.savedUSD);
  return {
    neutral: false, connected: true, live: true,
    measured: fmt(m.savedUSD), savedPct: Math.round(m.savedPct),
    allTime: fmt(ledger),
    sessions: m.turns || 0, spend: fmt(m.spendUSD || 0),
    latestFile: m.project || "", model: m.model || "",
    score: Math.max(0, Math.min(100, m.savedPct || 0)),
    activeProfile: (sess && sess.mode) || readMode0(),
    recommended: sess ? sess.recommended : null,
    auto: sess ? !!sess.auto : true,
    reasons: sess ? (sess.reasons || []) : [],
    profiles: { careful: { finds: [] }, balanced: { finds: [] }, aggressive: { finds: [] } },
  };
}
function readMode0() { const m = readMode(); return m === "auto" ? "balanced" : m; }
// All-time = sum of what Obol measured per transcript, no double counting.
function creditLedger(file, savedUSD) {
  try {
    const L = readLedger();
    if (!L.files) L.files = {};
    const prev = L.files[file] || 0;
    const delta = (savedUSD || 0) - prev;
    if (delta > 0.0000001) { L.allTime = (L.allTime || 0) + delta; L.files[file] = savedUSD; writeLedger(L); }
    return L.allTime || 0;
  } catch (e) { return ledgerAllTime(); }
}

function computeLive(sess) {
  const score = sess.savedPct != null ? Math.max(0, Math.min(100, sess.savedPct)) : null;
  return {
    neutral: false, connected: true, live: true,
    measured: fmt(sess.savedUSD || 0), savedPct: Math.round(sess.savedPct || 0),
    allTime: fmt(ledgerAllTime()),
    sessions: sess.turns || 0, spend: fmt(sess.spendUSD || 0),
    latestFile: sess.project || "", model: sess.model || "",
    score: score,
    activeProfile: sess.mode || "balanced",
    recommended: sess.recommended || null,
    auto: !!sess.auto,
    reasons: sess.reasons || [],
    profiles: { careful: { finds: [] }, balanced: { finds: [] }, aggressive: { finds: [] } },
  };
}
// Active: after a real analyze fires — shows the analyzed session + ledger all-time.
function computeActive() {
  try {
    const { u, live } = liveUsage();
    const allTime = updateLedger(live ? u : null);
    const report = core.buildReport(u, VERSION, core.resolveProfile("balanced"), live ? core.summarize(core.loadHistory()) : core.demoHistory());
    const obol = panel.computeObol(report);
    obol.connected = live; obol.neutral = false; obol.allTime = fmt(allTime);
    return obol;
  } catch (e) { return {}; }
}

function buildHtml(obol) {
  let html = fs.readFileSync(CARD, "utf8");
  const data = "<script>window.OBOL=" + JSON.stringify(obol).replace(/<\//g, "<\\/") + ";</script>\n";
  html = html.replace("<script>", function () { return data + "<script>"; });
  // make the card draggable (interactive bits stay clickable), add a close dot, wire live IPC refresh
  const inject =
    '<style>'+'html,body{height:auto;background:#131119;overflow:hidden;-webkit-user-select:none;user-select:none;}'+'.wrap{padding:0 !important;}'+'.card{max-width:none !important;width:100%;border:none !important;border-radius:0 !important;-webkit-app-region:drag;}'+'#bg{border-radius:0 !important;}'+'button,.tab,.ddbar,.tab .i,#obx,a,input,.obSeg,#obShareCanvas,#obShareOv,#obShareOv *{-webkit-app-region:no-drag;}'+'</style>' +
    '<div id="obx" title="Close" style="position:fixed;top:9px;right:11px;z-index:99;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.08);color:#cbc9d6;border:0.5px solid rgba(255,255,255,0.22);font-size:13px;line-height:20px;text-align:center;cursor:pointer;font-family:Poppins,sans-serif;">×</div>' +
    '<script>(function(){var x=document.getElementById("obx");if(x)x.onclick=function(){try{require("electron").ipcRenderer.send("obol-close");}catch(e){window.close();}};' +
    'try{var ipc=require("electron").ipcRenderer;ipc.on("obol",function(e,o){try{window.__obolApply(o);}catch(_){}});}catch(e){}' +
    'var rep=function(){try{var h=Math.ceil(document.querySelector(".wrap").getBoundingClientRect().height);require("electron").ipcRenderer.send("obol-size",h);}catch(_){}};' +
    'try{new ResizeObserver(rep).observe(document.querySelector(".wrap"));}catch(_){}' +
    'window.__obolSetMode=function(m){try{require("electron").ipcRenderer.send("obol-mode",m);}catch(_){}}; ' +
    'window.addEventListener("load",rep);setTimeout(rep,80);setTimeout(rep,500);})();</script>';
  html = html.replace("</body>", function () { return inject + SHARE + PLAN + "</body>"; });
  return html;
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 380, height: 500, minWidth: 320, minHeight: 300,
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: false,
    backgroundColor: "#131119", title: "Obol Live",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.setAlwaysOnTop(true, "floating");
  const t0 = computeTailed();
  const sess0 = liveSession();
  const html = buildHtml(t0 || (sess0 ? computeLive(sess0) : computeNeutral()));
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

let hasAnalyzed = false;
function refresh(focus) {
  if (!win || win.isDestroyed()) return;
  if (focus) hasAnalyzed = true;
  const tailed = computeTailed();
  const sess = liveSession();
  const obol = tailed || (sess ? computeLive(sess) : (hasAnalyzed ? computeActive() : computeNeutral()));
  obol.justAnalyzed = !!focus;
  win.webContents.send("obol", obol);
  if (focus) { try { win.showInactive(); win.setAlwaysOnTop(true, "floating"); win.moveTop(); } catch (e) {} }
}

function watchLive() {
  // 1) periodic refresh
  setInterval(() => refresh(false), 4000);
  try { fs.watchFile(SESSION_FILE, { interval: 1000 }, () => refresh(false)); } catch (e) {}
  // 2) watch the Claude Code logs for changes
  for (const dir of [path.join(os.homedir(), ".claude", "projects"), path.join(os.homedir(), ".config", "claude", "projects")]) {
    try { if (fs.existsSync(dir)) fs.watch(dir, { recursive: true }, debounce(() => refresh(false), 1500)); } catch (e) {}
  }
  // 3) watch the /analyze signal file specifically (NOT the whole ~/.obol dir, since
  //    ledger.json writes live there too and would otherwise flip us to active).
  try {
    const dir = path.join(os.homedir(), ".obol");
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, "live-refresh");
    if (!fs.existsSync(f)) fs.writeFileSync(f, "0");
    let last = 0;
    try { last = fs.statSync(f).mtimeMs; } catch (e) {}
    const onChange = debounce(() => {
      let m = 0; try { m = fs.statSync(f).mtimeMs; } catch (e) {}
      if (m && m !== last) { last = m; refresh(true); }
    }, 250);
    try { fs.watch(f, onChange); } catch (e) { fs.watchFile(f, { interval: 1000 }, onChange); }
  } catch (e) {}
}

function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

ipcMain.on("obol-close", () => { if (win) win.close(); });
ipcMain.on("obol-mode", (e, mode) => { writeMode(mode); refresh(false); });
/* Price the next turn locally: uses this session's real context as the baseline. */
ipcMain.handle("obol-estimate", (e, text) => {
  if (!est || !cls) return null;
  let avgCtx = 0, sess = null;
  try {
    sess = tail ? tail.measure(core, { maxAgeMs: 6 * 60 * 60 * 1000 }) : null;
    if (sess && sess.turns) avgCtx = Math.round((sess.tokens || 0) / Math.max(1, sess.turns));
  } catch (e2) {}
  if (!avgCtx) avgCtx = 20000;
  try { return est.estimate(core, { text, mode: readMode(), classify: cls.classify, sessionAvgContext: avgCtx, session: sess, currentModel: (sess && sess.model) || "" }); }
  catch (e3) { return null; }
});
ipcMain.on("obol-copy-png", (e, dataUrl) => {
  try { clipboard.writeImage(nativeImage.createFromDataURL(dataUrl)); } catch (e2) {}
});
ipcMain.on("obol-save-png", async (e, dataUrl) => {
  try {
    const r = await dialog.showSaveDialog(win, { title: "Save Obol share card", defaultPath: "obol-savings.png", filters: [{ name: "PNG image", extensions: ["png"] }] });
    if (!r.canceled && r.filePath) {
      const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(r.filePath, Buffer.from(b64, "base64"));
    }
  } catch (e2) {}
});
ipcMain.on("obol-size", (e, h) => {
  if (!win || win.isDestroyed()) return;
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const maxH = Math.min(wa.height - 60, 1000), minH = 300;
    const nh = Math.max(minH, Math.min(maxH, Math.ceil(h)));
    const sz = win.getContentSize();
    if (Math.abs(sz[1] - nh) > 1) win.setContentSize(sz[0], nh);
  } catch (e2) {}
});

app.whenReady().then(() => { createWindow(); watchLive(); });
app.on("window-all-closed", () => app.quit());
