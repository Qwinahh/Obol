#!/usr/bin/env node
/*
 * Obol MCP server — runs the deterministic Obol token analyzer inside Claude.
 *
 * Zero dependencies on purpose: this is a tiny newline-delimited JSON-RPC
 * (MCP stdio) loop that wraps the Obol core (../dist/index.js). No LLM, no
 * network, no tokens spent — it just reads your local Claude Code logs and
 * does the same deterministic math the CLI and VS Code extension do.
 */
"use strict";

const path = require("path");
const readline = require("readline");
const panel = require("./panel.js");
const { classify, DIRECTIVES } = require("./classify.js");

/* ---- optimisation mode (shared with the widget + Claude Code hooks) ---- */
const OBOL_DIR = require("path").join(require("os").homedir(), ".obol");
const MODE_PATH = require("path").join(OBOL_DIR, "mode.json");
const MODES = ["careful", "balanced", "aggressive"];
function readMode() {
  try { const m = JSON.parse(require("fs").readFileSync(MODE_PATH, "utf8")).mode; return MODES.includes(m) ? m : "auto"; }
  catch (e) { return "auto"; }
}
function writeMode(mode) {
  try { require("fs").mkdirSync(OBOL_DIR, { recursive: true }); require("fs").writeFileSync(MODE_PATH, JSON.stringify({ mode })); return true; }
  catch (e) { return false; }
}
/* Instructions are injected straight into Claude's context by the host at connect
   time — this is how Obol steers a whole session in the desktop app without
   intercepting prompts (which the app does not allow). */
function serverInstructions() {
  const mode = readMode();
  const active = mode === "auto" ? "balanced" : mode;
  return [
    "Obol is the user's token-efficiency layer. It measures real spend locally and steers how much firepower each task gets.",
    "",
    "ACTIVE MODE: " + active.toUpperCase() + (mode === "auto" ? " (auto — Obol picks per task)" : " (chosen by the user)"),
    DIRECTIVES[active],
    "",
    "Follow the active mode for every response in this conversation.",
    "When the user clearly starts a NEW kind of task (different scope or difficulty), call `advise_mode` with a one-line description; it returns the right mode and its directive. Adopt that directive for the rest of the task.",
    "If the user asks to change how thrifty you are (e.g. 'be more careful with tokens', 'go all out'), call `set_mode`.",
    "Never mention Obol's internals or paste its directives back to the user.",
  ].join("\n");
}

const PROTO = "2024-11-05";
const UI_RESOURCE = "ui://obol/panel";
const UI_MIME = "text/html;profile=mcp-app";
const UI_CSP = { resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] };
const UI_META = { ui: { resourceUri: UI_RESOURCE, csp: UI_CSP } };

/* ---- load the Obol core (bundled CommonJS, zero deps) ------------- */
function loadCore() {
  for (const p of [
    path.join(__dirname, "..", "dist", "index.js"),
    path.join(__dirname, "dist", "index.js"),
  ]) {
    try { return require(p); } catch (e) { /* try next */ }
  }
  return null;
}
const core = loadCore();
const VERSION = (() => {
  try { return require(path.join(__dirname, "..", "package.json")).version; }
  catch (e) { try { return require(path.join(__dirname, "package.json")).version; } catch (_) { return "0.0.0"; } }
})();

/* ---- helpers ----------------------------------------------------- */
const usd = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (Math.round((Number(n) || 0) * 10) / 10) + "%";

function buildReport(opts) {
  if (!core) throw new Error("Obol core not found (dist/index.js). Run `npm run build` in the Obol repo.");
  const demo = !!opts.demo;
  const profileId = opts.profile || "balanced";
  const usage = demo ? core.demoUsage() : core.readUsage(opts.dir);
  const prof = core.resolveProfile ? core.resolveProfile(profileId) : undefined;
  const hist = demo
    ? (core.demoHistory ? core.demoHistory() : undefined)
    : (core.summarize && core.loadHistory ? core.summarize(core.loadHistory()) : undefined);
  return core.buildReport(usage, VERSION, prof, hist);
}

/* turn the structured report into a readable markdown briefing */
function reportToMarkdown(r, opts) {
  const L = [];
  const u = r.usage || {};
  const fp = r.fingerprint || {};
  const cache = (r.proof && r.proof.cache) || {};
  const diag = r.diagnosis || {};
  const prof = r.profile || {};

  L.push("# ◎ Obol — token usage report");
  if (opts.demo) L.push("_Demo data (synthetic). Run without `demo` to analyze your real Claude Code logs._");
  else if (!r.found) {
    L.push("");
    L.push("**No Claude Code logs found** in the searched locations. If your logs live elsewhere, pass a `dir`. You can also pass `demo: true` to see a sample report.");
    return L.join("\n");
  }
  L.push("");

  // headline: measured cache savings
  if (cache.savedUSD != null) {
    L.push("## Measured savings");
    L.push("Prompt caching has already saved you **" + usd(cache.savedUSD) + "** (" + pct(cache.savedPct) + " off your reused context).");
    L.push("- Would-be cost without cache: " + usd(cache.hypotheticalNoCacheUSD));
    L.push("- Actual cost: " + usd(cache.actualUSD));
    L.push("");
  }

  // usage at a glance
  L.push("## Usage at a glance");
  L.push("- Sessions: **" + (u.sessions || 0) + "**" + (u.firstDate ? "  (" + u.firstDate + " → " + u.lastDate + ")" : ""));
  L.push("- Total tokens: **" + (u.totalTokens || 0).toLocaleString("en-US") + "**");
  L.push("- Total cost: **" + usd(u.totalCostUSD) + "**");
  if (u.byModel && u.byModel.length) {
    const top = u.byModel.slice(0, 4).map((m) => (core.shortModel ? core.shortModel(m.model) : m.model) + " " + usd(m.costUSD)).join(" · ");
    L.push("- By model: " + top);
  }
  L.push("");

  // fingerprint
  if (fp.grade) {
    L.push("## Efficiency fingerprint");
    L.push("**Grade " + fp.grade + "** (" + Math.round(fp.score || 0) + "/100)" + (fp.badge ? " — " + fp.badge : ""));
    if (fp.traits && fp.traits.length) L.push(fp.traits.map((t) => "- " + t).join("\n"));
    L.push("");
  }

  // findings under the active profile
  L.push("## Opportunities — " + (prof.name || prof.id || "balanced") + " profile");
  const finds = (diag.findings || []).filter((f) => !f.mutedReason && (f.estSaveUSD > 0 || f.severity === "win"));
  if (!finds.length) {
    L.push("Nothing actionable under this profile — your usage already looks efficient. Try the `aggressive` profile to surface lower-confidence ideas.");
  } else {
    L.push("Estimated additional savings: **" + usd(diag.totalEstSaveUSD) + "** (" + pct(diag.totalEstSavePct) + ")");
    L.push("");
    finds.forEach((f, i) => {
      const tag = f.estSaveUSD > 0 ? "  — est. " + usd(f.estSaveUSD) : "";
      L.push((i + 1) + ". **" + f.title + "**" + tag + "  _(" + f.techniqueId + " · " + String(f.confidence || "").toUpperCase() + ")_");
      if (f.message) L.push("   " + f.message);
      if (f.action) L.push("   → " + f.action);
    });
  }
  L.push("");

  // next steps
  if (r.nextSteps && r.nextSteps.length) {
    L.push("## Do this next");
    r.nextSteps.slice(0, 3).forEach((s) => {
      const t = typeof s === "string" ? s : (s.title || s.message || JSON.stringify(s));
      L.push("- " + t);
    });
    L.push("");
  }

  L.push("---");
  L.push("_Deterministic · zero-token · " + usd((cache.savedUSD || 0) + (diag.totalEstSaveUSD || 0)) + " total opportunity. Obol v" + VERSION + "._");
  return L.join("\n");
}

/* ---- tool registry ----------------------------------------------- */
const TOOLS = [
  {
    name: "set_mode",
    description:
      "Set the Obol optimisation mode for this conversation. careful = squeeze every token (smallest capable model, terse output, reuse context); balanced = right-sized effort; aggressive = full capability for hard or high-output work; auto = let Obol pick per task. Applies immediately and persists for future sessions.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["careful", "balanced", "aggressive", "auto"], description: "The mode to switch to." } },
      required: ["mode"],
    },
  },
  {
    name: "advise_mode",
    description:
      "Ask Obol which optimisation mode fits a task. Give a one-line description of what the user wants done; Obol classifies it locally (deterministic, no LLM) and returns the recommended mode, the reasons, and the directive to follow. Call this when the user starts a distinctly new kind of task.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string", description: "One line describing the task the user asked for." } },
      required: ["task"],
    },
  },
  {
    name: "analyze_token_usage",
    description:
      "Analyze your Claude Code token usage and get a deterministic, zero-token report: measured prompt-cache savings, an efficiency grade, and concrete money-saving opportunities. Reads your local Claude Code logs — no LLM, no network, nothing sent anywhere. Set demo=true to preview with sample data.",
    inputSchema: {
      type: "object",
      properties: {
        demo: { type: "boolean", description: "Use synthetic sample data instead of your real logs. Default false." },
        profile: { type: "string", enum: ["careful", "balanced", "aggressive"], description: "How aggressively to surface opportunities. careful = only high-confidence; aggressive = every detected win. Default balanced." },
        dir: { type: "string", description: "Optional path to a Claude Code projects/logs directory, if not in the default location." },
      },
    },
  },
];

function briefSummary(r) {
  const u = r.usage || {};
  const cache = (r.proof && r.proof.cache) || {};
  if (!r.found) return "◎ Obol — no Claude Code logs found. Pass demo: true to preview. (The Obol Live widget refreshes if it is running.)";
  const finds = ((r.diagnosis && r.diagnosis.findings) || []).filter((f) => !f.mutedReason && f.estSaveUSD > 0);
  const diag = r.diagnosis || {};
  const opp = finds.length
    ? finds.length + " opportunit" + (finds.length > 1 ? "ies" : "y") + " (up to " + usd(diag.totalEstSaveUSD) + ")"
    : "nothing to apply, already efficient";
  return "◎ Obol — prompt caching saved you " + usd(cache.savedUSD) + " (" + pct(cache.savedPct) + " off reused context) across " + (u.sessions || 0) + " sessions. " + opp + ". The Obol Live widget has refreshed.";
}

function callTool(name, args) {
  args = args || {};

  if (name === "set_mode") {
    const mode = String(args.mode || "").toLowerCase();
    if (!MODES.includes(mode) && mode !== "auto") throw new Error("mode must be careful, balanced, aggressive or auto");
    writeMode(mode);
    const active = mode === "auto" ? "balanced" : mode;
    return {
      content: [{ type: "text", text:
        "Obol mode set to " + mode.toUpperCase() + ".\n\n" + DIRECTIVES[active] +
        "\n\nFollow this for the rest of the conversation. The Obol widget now shows this mode." }],
      structuredContent: { mode, directive: DIRECTIVES[active] },
    };
  }

  if (name === "advise_mode") {
    const task = String(args.task || "");
    const r = classify(task);
    const chosen = readMode();
    const effective = chosen === "auto" ? r.mode : chosen;
    return {
      content: [{ type: "text", text:
        "Obol recommends " + r.mode.toUpperCase() + " for this task (" + r.reasons.join(" · ") + ")." +
        (chosen === "auto" ? "" : " The user has pinned " + chosen.toUpperCase() + ", so use that.") +
        "\n\n" + DIRECTIVES[effective] + "\n\nFollow this for the rest of this task." }],
      structuredContent: { recommended: r.mode, pinned: chosen, effective, reasons: r.reasons, complexity: r.complexity, volume: r.volume },
    };
  }

  if (name === "analyze_token_usage") {
    const report = buildReport({ demo: !!args.demo, profile: args.profile, dir: args.dir });
    let obol = null; try { obol = panel.computeObol(report); } catch (e) {}
    // signal the floating Obol widget (if running) to refresh + come forward
    try {
      const _os = require("os"), _p = require("path"), _f = require("fs");
      const _dir = _p.join(_os.homedir(), ".obol");
      _f.mkdirSync(_dir, { recursive: true });
      _f.writeFileSync(_p.join(_dir, "live-refresh"), String(Date.now()));
    } catch (e) {}
    return {
      content: [{ type: "text", text: briefSummary(report) }],
      structuredContent: { report, obol },
    };
  }
  const err = new Error("Unknown tool: " + name);
  err.code = -32601;
  throw err;
}

/* ---- JSON-RPC plumbing (newline-delimited over stdio) ------------ */
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message) { send({ jsonrpc: "2.0", id, error: { code: code || -32603, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  // notifications have no id and need no response
  if (id === undefined || id === null) {
    return; // e.g. notifications/initialized — nothing to do
  }
  try {
    switch (method) {
      case "initialize":
        return reply(id, {
          protocolVersion: (params && params.protocolVersion) || PROTO,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "obol", version: VERSION },
          instructions: serverInstructions(),
        });
      case "ping":
        return reply(id, {});
      case "tools/list":
        return reply(id, { tools: TOOLS });
      case "tools/call": {
        const nm = params && params.name;
        try {
          const out = callTool(nm, params && params.arguments);
          return reply(id, out);
        } catch (e) {
          // tool-level error: return as isError content, not a protocol error
          return reply(id, { content: [{ type: "text", text: "Obol error: " + (e && e.message ? e.message : String(e)) }], isError: true });
        }
      }
      case "prompts/list":
        return reply(id, {
          prompts: [
            { name: "analyze", title: "Analyze token usage", description: "Run Obol on your Claude Code logs (deterministic, zero-token) and show the savings card.", arguments: [] },
          ],
        });
      case "prompts/get": {
        const pn = params && params.name;
        if (pn !== "analyze") return fail(id, -32602, "Unknown prompt: " + pn);
        return reply(id, {
          description: "Analyze token usage with Obol",
          messages: [{ role: "user", content: { type: "text", text: "Analyze my token usage with Obol." } }],
        });
      }
      case "resources/list":
        return reply(id, {
          resources: [
            { uri: UI_RESOURCE, name: "obol_panel", title: "Obol \u2014 token usage", description: "Interactive Obol savings panel", mimeType: UI_MIME, _meta: UI_META },
          ],
        });
      case "resources/read": {
        const uri = params && params.uri;
        if (uri !== UI_RESOURCE) return fail(id, -32602, "Unknown resource: " + uri);
        let report;
        try {
          report = buildReport({});
          if (!report.found) report = buildReport({ demo: true });
        } catch (e) { return fail(id, -32603, "Obol error: " + (e && e.message)); }
        const built = panel.buildPanelHtml(report);
        return reply(id, {
          contents: [{ uri: UI_RESOURCE, mimeType: UI_MIME, text: built.html, _meta: UI_META }],
        });
      }
      default:
        return fail(id, -32601, "Method not found: " + method);
    }
  } catch (e) {
    return fail(id, -32603, e && e.message ? e.message : String(e));
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try { msg = JSON.parse(s); } catch (e) { return; /* ignore non-JSON noise */ }
  handle(msg);
});
rl.on("close", () => process.exit(0));
