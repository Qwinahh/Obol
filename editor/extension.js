"use strict";
// Obol — VS Code extension (Step 10).
// The same deterministic core that powers the CLI and the Claude Code plugin,
// surfaced as an in-editor report. Zero tokens: every number here is computed
// locally by requiring the bundled core in-process — no child process, no PATH
// dependency, no network. The one paid feature (the Quality Guard's live check)
// stays in the CLI behind ANTHROPIC_API_KEY and is never invoked from here.
const vscode = require("vscode");
const path = require("path");
const { buildHtml } = require("./render");

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

/** Open (or reuse) the report panel and render a report into it. */
let panel = null;
function showReport(context, core, report, demo) {
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "obolReport", "Obol — Token Report",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.onDidDispose(() => { panel = null; });
    panel.webview.onDidReceiveMessage((msg) => handleMessage(context, core, msg));
  }
  panel.webview.html = buildHtml(report, { demo, cspSource: panel.webview.cspSource });
  panel.reveal();
}

function handleMessage(context, core, msg) {
  if (!msg || !msg.cmd) return;
  if (msg.cmd === "demo") {
    showReport(context, core, core.buildReport(core.demoUsage(), version(core)), true);
  } else if (msg.cmd === "analyze") {
    const r = core.buildReport(core.readUsage(undefined), version(core));
    showReport(context, core, r, false);
  } else if (msg.cmd === "apply") {
    runApply(context, core);
  } else if (msg.cmd === "guardHint") {
    vscode.window.showInformationMessage(
      "The Quality Guard's live check is the one feature that spends tokens. Run it from a terminal: set ANTHROPIC_API_KEY then `obol --guard` (~<$0.01)."
    );
  }
}

/** Write the green (safe, reversible) fixes into the workspace CLAUDE.md. */
function runApply(context, core) {
  try {
    const root = workspaceRoot();
    const usage = core.readUsage(undefined);
    const d = core.diagnose(usage);
    const plan = core.planApply(d, usage, root);
    if (!plan.green.length) {
      vscode.window.showInformationMessage("Obol: no safe auto-fixes to apply right now.");
      return;
    }
    const results = core.applyGreen(plan);
    const ok = results.filter((r) => r.ok);
    if (ok.length) {
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
    vscode.commands.registerCommand("obol.optimize", () => {
      const r = core.buildReport(core.readUsage(undefined), version(core));
      showReport(context, core, r, false);
    }),
    vscode.commands.registerCommand("obol.demo", () => {
      showReport(context, core, core.buildReport(core.demoUsage(), version(core)), true);
    }),
    vscode.commands.registerCommand("obol.apply", () => runApply(context, core)),
    vscode.commands.registerCommand("obol.terminal", () => runInTerminal(context, []))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
