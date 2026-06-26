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

function computeNow() {
  try {
    const usage = core.readUsage();
    const live = !!(usage && usage.found);
    const report = live
      ? core.buildReport(usage, VERSION, core.resolveProfile("balanced"), core.summarize(core.loadHistory()))
      : core.buildReport(core.demoUsage(), VERSION, core.resolveProfile("balanced"), core.demoHistory());
    const obol = panel.computeObol(report);
    obol.connected = live;
    return obol;
  } catch (e) { return {}; }
}

function buildHtml(obol) {
  let html = fs.readFileSync(CARD, "utf8");
  const data = "<script>window.OBOL=" + JSON.stringify(obol).replace(/<\//g, "<\\/") + ";</script>\n";
  html = html.replace("<script>", function () { return data + "<script>"; });
  // make the card draggable (interactive bits stay clickable), add a close dot, wire live IPC refresh
  const inject =
    '<style>'+'html,body{height:auto;background:#131119;overflow:hidden;}'+'.wrap{padding:0 !important;}'+'.card{max-width:none !important;width:100%;border:none !important;border-radius:0 !important;}'+'.hd{-webkit-app-region:drag;} .hd .brand{-webkit-app-region:drag;}'+'#bg{border-radius:0 !important;}'+'button,.tab,.ddbar,.tab .i,#obx,a{-webkit-app-region:no-drag;}'+'</style>' +
    '<div id="obx" title="Close" style="position:fixed;top:9px;right:11px;z-index:99;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.08);color:#cbc9d6;border:0.5px solid rgba(255,255,255,0.22);font-size:13px;line-height:20px;text-align:center;cursor:pointer;font-family:Poppins,sans-serif;">×</div>' +
    '<script>(function(){var x=document.getElementById("obx");if(x)x.onclick=function(){try{require("electron").ipcRenderer.send("obol-close");}catch(e){window.close();}};' +
    'try{var ipc=require("electron").ipcRenderer;ipc.on("obol",function(e,o){try{window.__obolApply(o);}catch(_){}});}catch(e){}' +
    'var rep=function(){try{var h=Math.ceil(document.querySelector(".wrap").getBoundingClientRect().height);require("electron").ipcRenderer.send("obol-size",h);}catch(_){}};' +
    'try{new ResizeObserver(rep).observe(document.querySelector(".wrap"));}catch(_){}' +
    'window.addEventListener("load",rep);setTimeout(rep,80);setTimeout(rep,500);})();</script>';
  html = html.replace("</body>", function () { return inject + SHARE + "</body>"; });
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
  const html = buildHtml(computeNow());
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

function refresh(focus) {
  if (!win || win.isDestroyed()) return;
  const obol = computeNow();
  obol.justAnalyzed = !!focus;
  win.webContents.send("obol", obol);
  if (focus) { try { win.showInactive(); win.setAlwaysOnTop(true, "floating"); win.moveTop(); } catch (e) {} }
}

function watchLive() {
  // 1) periodic refresh
  setInterval(() => refresh(false), 20000);
  // 2) watch the Claude Code logs for changes
  for (const dir of [path.join(os.homedir(), ".claude", "projects"), path.join(os.homedir(), ".config", "claude", "projects")]) {
    try { if (fs.existsSync(dir)) fs.watch(dir, { recursive: true }, debounce(() => refresh(false), 1500)); } catch (e) {}
  }
  // 3) watch the /analyze signal from the Claude extension
  try {
    const dir = path.join(os.homedir(), ".obol");
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, "live-refresh");
    if (!fs.existsSync(f)) fs.writeFileSync(f, "0");
    fs.watch(dir, debounce((ev, name) => { if (!name || name === "live-refresh") refresh(true); }, 300));
  } catch (e) {}
}

function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

ipcMain.on("obol-close", () => { if (win) win.close(); });
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
