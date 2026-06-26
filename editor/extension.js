"use strict";
// Obol — VS Code extension (Step 10).
// The same deterministic core that powers the CLI and the Claude Code plugin,
// surfaced as an in-editor report. Zero tokens: every number here is computed
// locally by requiring the bundled core in-process — no child process, no PATH
// dependency, no network. The one paid feature (the Quality Guard's live check)
// stays in the CLI behind ANTHROPIC_API_KEY and is never invoked from here.
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { buildHtml } = require("./render");

const PROFILE_KEY = "obol.profile.v1";

const DEMO_BOARD = [
  { rank: 1, name: "tess", displayName: "tess", savedUSD: 184.20, verified: true },
  { rank: 2, name: "you", displayName: "you", savedUSD: 107.10, verified: false },
  { rank: 3, name: "rafa", displayName: "rafa", savedUSD: 88.40, verified: true },
  { rank: 4, name: "kit", displayName: "kit", savedUSD: 51.05, verified: false },
  { rank: 5, name: "dev_n", displayName: "dev_n", savedUSD: 22.90, verified: false },
];

/** Resolve the bundled core (dist/index.js copied in at build time). */
function loadCore(context) {
  return require(path.join(context.extensionPath, "dist", "index.js"));
}

function workspaceRoot() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length ? f[0].uri.fsPath : process.cwd();
}

let context_; // set in activate; used by version() lookups
function version(core) {
  try { return require(path.join(context_.extensionPath, "package.json")).version; }
  catch { return "0.0.1"; }
}

/** Persisted profile (id + per-technique disabled set). Survives reloads. */
function getProfile(context, core) {
  const saved = context.globalState.get(PROFILE_KEY);
  return core.resolveProfile(saved || null);
}
function saveProfile(context, profile) {
  // Store only the user's choices; minConfidence is derived from the preset.
  context.globalState.update(PROFILE_KEY, { id: profile.id, disabled: profile.disabled });
}

// Last inputs, so a profile/toggle change can rebuild authoritatively without
// re-reading logs (pure local re-filter of the same usage object).
let session = { usage: null, demo: false, history: null, lbEntries: null };

/** Open (or reuse) the report panel and render a report into it. */
let panel = null;
function showReport(context, core, report, demo) {
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "obolReport", "Obol — Token Report",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.onDidDispose(() => { panel = null; stopActivityWatch(); });
    panel.webview.onDidReceiveMessage((msg) => handleMessage(context, core, msg));
  }
  let shareSvg = "";
  try { shareSvg = core.shareCard(report); } catch (e) { shareSvg = ""; }
  let leaderboard;
  try {
    const configured = !!process.env.OBOL_LEADERBOARD_URL;
    let name; try { name = (core.loadIdentity().name) || undefined; } catch (e) {}
    if (demo) {
      leaderboard = { configured, name: name || "you", entries: DEMO_BOARD, note: "example" };
    } else {
      leaderboard = { configured, name, entries: session.lbEntries || undefined };
    }
  } catch (e) { leaderboard = { configured: false }; }
  let activity;
  if (demo) {
    activity = { demo: true, sequence: core.demoActivity(), start: "Watching a sample session\u2026" };
  } else {
    activity = { demo: false, start: "Watching your session for activity\u2026" };
  }
  panel.webview.html = buildHtml(report, { demo, cspSource: panel.webview.cspSource, shareSvg, leaderboard, activity });
  panel.reveal();
  if (!demo) startActivityWatch(core);
}

/** Rebuild the report for the current session under the current profile. */
function rebuild(context, core) {
  if (!session.usage) return;
  const profile = getProfile(context, core);
  const report = core.buildReport(session.usage, version(core), profile, session.history || undefined);
  showReport(context, core, report, session.demo);
}

function analyze(context, core, demo) {
  session.usage = demo ? core.demoUsage() : core.readUsage(undefined);
  session.demo = demo;
  const profile = getProfile(context, core);
  if (demo) {
    session.history = core.demoHistory();
  } else {
    try {
      const r = core.buildReport(session.usage, version(core), profile);
      session.history = core.recordRun({
        kind: "scan", profile: profile.id,
        estSaveUSD: r.diagnosis.totalEstSaveUSD,
        receiptSavedUSD: r.proof.cache.savedUSD,
        appliedGreen: 0, appliedSaveUSD: 0,
      });
    } catch (e) { session.history = null; }
  }
  rebuild(context, core);
}

function handleMessage(context, core, msg) {
  if (!msg || !msg.cmd) return;
  if (msg.cmd === "demo") {
    analyze(context, core, true);
  } else if (msg.cmd === "analyze") {
    analyze(context, core, false);
  } else if (msg.cmd === "profile") {
    // Switch preset; keep the user's per-technique toggles.
    const current = getProfile(context, core);
    const next = core.resolveProfile({ id: msg.id, disabled: current.disabled });
    saveProfile(context, next);
    rebuild(context, core);
  } else if (msg.cmd === "toggle") {
    // Flip one technique on/off within the active preset.
    const current = getProfile(context, core);
    const disabled = new Set(current.disabled);
    if (disabled.has(msg.id)) disabled.delete(msg.id); else disabled.add(msg.id);
    const next = core.resolveProfile({ id: current.id, disabled: Array.from(disabled) });
    saveProfile(context, next);
    rebuild(context, core);
  } else if (msg.cmd === "saveCard") {
    saveCard(context, msg);
  } else if (msg.cmd === "submit") {
    submitToLeaderboard(context, core);
  } else if (msg.cmd === "leaderboard") {
    refreshLeaderboard(context, core);
  } else if (msg.cmd === "apply") {
    runApply(context, core);
  } else if (msg.cmd === "guardHint") {
    vscode.window.showInformationMessage(
      "The Quality Guard's live check is the one feature that spends tokens. Run it from a terminal: set ANTHROPIC_API_KEY then `obol --guard` (~<$0.01)."
    );
  }
}

/** Write the green (safe, reversible) fixes into the workspace CLAUDE.md.
 *  Honors the active profile so Careful applies only what it surfaced. */
function runApply(context, core) {
  try {
    const root = workspaceRoot();
    const usage = session.usage || core.readUsage(undefined);
    const profile = getProfile(context, core);
    const d = core.filterDiagnosis(core.diagnose(usage), profile);
    const plan = core.planApply(d, usage, root);
    if (!plan.green.length) {
      vscode.window.showInformationMessage("Obol: no safe auto-fixes to apply under the current profile.");
      return;
    }
    const results = core.applyGreen(plan);
    const ok = results.filter((r) => r.ok);
    if (ok.length) {
      if (!session.demo) {
        try {
          session.history = core.recordRun({
            kind: "apply", profile: profile.id,
            estSaveUSD: d.totalEstSaveUSD,
            receiptSavedUSD: core.proof(usage).cache.savedUSD,
            appliedGreen: ok.length,
            appliedSaveUSD: plan.green.reduce((x, a) => x + (a.estSaveUSD || 0), 0),
          });
        } catch (e) { /* best-effort */ }
        if (session.usage) rebuild(context, core);
      }
      vscode.window.showInformationMessage(
        `Obol wrote ${ok.length} reversible fix${ok.length > 1 ? "es" : ""} to ${path.basename(ok[0].target)} (delete between the obol markers to undo).`
      );
      vscode.workspace.openTextDocument(ok[0].target).then((doc) => vscode.window.showTextDocument(doc, { preview: true }));
    } else {
      vscode.window.showWarningMessage("Obol: " + (results[0] && results[0].note || "nothing applied."));
    }
  } catch (e) {
    vscode.window.showErrorMessage("Obol apply failed: " + (e && e.message || e));
  }
}

/** Save the share card the webview produced (svg text or rasterised png base64). */
function saveCard(context, msg) {
  try {
    const root = workspaceRoot();
    if (msg.fmt === "png" && typeof msg.data === "string") {
      const b64 = msg.data.replace(/^data:image\/png;base64,/, "");
      const file = path.join(root, "obol-card.png");
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      vscode.window.showInformationMessage("Obol: saved share card → " + path.basename(file));
      vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
    } else if (typeof msg.data === "string") {
      const file = path.join(root, "obol-card.svg");
      fs.writeFileSync(file, msg.data, "utf8");
      vscode.window.showInformationMessage("Obol: saved share card → " + path.basename(file));
      vscode.workspace.openTextDocument(file).then((doc) => vscode.window.showTextDocument(doc, { preview: true }));
    }
  } catch (e) {
    vscode.window.showErrorMessage("Obol: couldn't save the card — " + (e && e.message || e));
  }
}

// --- live activity tail: follow the session log Claude Code is writing now ---
let actWatch = { watcher: null, file: null, offset: 0, timer: null };
function stopActivityWatch() {
  try { if (actWatch.watcher) actWatch.watcher.close(); } catch (e) {}
  if (actWatch.timer) { clearTimeout(actWatch.timer); actWatch.timer = null; }
  actWatch.watcher = null; actWatch.file = null; actWatch.offset = 0;
}
function postEvents(events) {
  if (!panel || !events || !events.length) return;
  try { panel.webview.postMessage({ cmd: "activityBatch", events }); } catch (e) {}
}
function pumpActivity(core) {
  try {
    // re-resolve the newest session each pump — Claude Code may rotate files
    const dir = (session.usage && session.usage.source) || undefined;
    const newest = core.activeSessionFile(dir);
    if (newest && newest !== actWatch.file) {
      // a newer session appeared; start from its current end (only show new work)
      actWatch.file = newest;
      try { actWatch.offset = require("fs").statSync(newest).size; } catch (e) { actWatch.offset = 0; }
      return;
    }
    if (!actWatch.file) return;
    const res = core.tail(actWatch.file, actWatch.offset);
    actWatch.offset = res.nextByte;
    postEvents(res.events);
  } catch (e) { /* best-effort, never throw */ }
}
function startActivityWatch(core) {
  stopActivityWatch();
  try {
    const dir = (session.usage && session.usage.source) || undefined;
    if (!dir) return;
    const newest = core.activeSessionFile(dir);
    if (newest) { actWatch.file = newest; try { actWatch.offset = require("fs").statSync(newest).size; } catch (e) {} }
    // poll on a calm cadence (fs.watch is unreliable across editors/OSes)
    const loop = () => { pumpActivity(core); actWatch.timer = setTimeout(loop, 1500); };
    actWatch.timer = setTimeout(loop, 1500);
  } catch (e) { /* best-effort */ }
}

/** Opt-in: sign + POST only public aggregates to the configured leaderboard. */
async function submitToLeaderboard(context, core) {
  const url = process.env.OBOL_LEADERBOARD_URL;
  if (!url) { vscode.window.showInformationMessage("Leaderboard is opt-in — set OBOL_LEADERBOARD_URL to a server you trust, then submit."); return; }
  try {
    const id = core.loadIdentity();
    if (!id.name) {
      const name = await vscode.window.showInputBox({ prompt: "Pick a leaderboard handle (a–z, 0–9, _ or -)", validateInput: (v) => (core.validateName(v).ok ? null : "2–24 chars: a–z, 0–9, _ or -") });
      if (!name) return;
      core.setName(name);
    }
    const ident = core.loadIdentity();
    const usage = session.usage || core.readUsage(undefined);
    const profile = getProfile(context, core);
    const report = core.buildReport(usage, version(core), profile, session.history || undefined);
    const signed = core.signSubmission(core.buildSubmission(report, ident.name), ident);
    const res = await fetch(url.replace(/\/$/, "") + "/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signed) });
    const out = await res.json();
    if (out && out.ok) { vscode.window.showInformationMessage("Obol: submitted — rank #" + out.rank); refreshLeaderboard(context, core); }
    else vscode.window.showWarningMessage("Obol: submission rejected — " + ((out && out.reason) || "unknown"));
  } catch (e) {
    vscode.window.showErrorMessage("Obol submit failed: " + (e && e.message || e));
  }
}

/** Opt-in: fetch the public board and re-render the panel with it. */
async function refreshLeaderboard(context, core) {
  const url = process.env.OBOL_LEADERBOARD_URL;
  if (!url) return;
  try {
    const res = await fetch(url.replace(/\/$/, "") + "/leaderboard?limit=20");
    const data = await res.json();
    session.lbEntries = (data && data.entries) || [];
    rebuild(context, core);
  } catch (e) {
    vscode.window.showWarningMessage("Obol: couldn't reach the leaderboard.");
  }
}

/** Run the full ANSI CLI in the integrated terminal (needs Node on PATH). */
function runInTerminal(context, args) {
  const cli = path.join(context.extensionPath, "dist", "cli.js");
  const term = vscode.window.createTerminal({ name: "Obol" });
  const q = (s) => '"' + s.replace(/"/g, '\\"') + '"';
  term.show();
  term.sendText(["node", q(cli)].concat(args).join(" "));
}

function activate(context) {
  context_ = context;
  let core;
  try { core = loadCore(context); }
  catch (e) {
    vscode.window.showErrorMessage("Obol: bundled core not found — run `npm run build` in the repo before packaging. " + (e && e.message || ""));
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("obol.optimize", () => analyze(context, core, false)),
    vscode.commands.registerCommand("obol.demo", () => analyze(context, core, true)),
    vscode.commands.registerCommand("obol.apply", () => runApply(context, core)),
    vscode.commands.registerCommand("obol.terminal", () => runInTerminal(context, []))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
