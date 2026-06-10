import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Diagnosis, Finding, UsageSummary } from "./types";

/**
 * Step 3.5 — the Apply step.
 * Turns a diagnosis into a concrete, reviewable change set. Two tiers, mirroring
 * the catalog's autoApply flag:
 *   - green : safe + reversible. Obol can write it for you (an idempotent,
 *             clearly-marked block in your project CLAUDE.md).
 *   - amber : detected and spelled out exactly — but a human approves. Obol
 *             NEVER edits live config (.mcp.json, ~/.claude.json) on its own.
 *
 * Deterministic and zero-token: the plan is pure math over the findings. Each
 * applied action is a discrete unit that Step 4 (the Quality Guard) can later
 * prove didn't degrade answers.
 */

export type ApplyKind = "memory-block" | "config-edit" | "hook" | "manual";

/** One concrete change derived from a finding. */
export interface ApplyAction {
  techniqueId: string;
  title: string;
  tier: "green" | "amber";
  kind: ApplyKind;
  target: string;        // file the change touches (or where to make it)
  summary: string;       // one-line what + why
  patch: string;         // the exact text/edit Obol would write or you'd paste
  reversible: boolean;
  estSaveUSD: number;
}

export interface ApplyPlan {
  actions: ApplyAction[];
  green: ApplyAction[];   // tier === "green" (Obol can write these)
  amber: ApplyAction[];   // tier === "amber" (review-only)
  /** Target file for the auto-writable memory block (your project CLAUDE.md). */
  memoryFile: string;
}

export interface AppliedResult {
  techniqueId: string;
  target: string;
  ok: boolean;
  note: string;
}

// Obol writes ONLY between these markers, so re-applying is idempotent and the
// block can be cleanly removed by hand. Everything outside is never touched.
const MARK_START = "<!-- obol:start — managed block, safe to delete -->";
const MARK_END = "<!-- obol:end -->";

/** The concise-output guidance Obol writes for a green C1 finding. */
const CONCISE_BLOCK = [
  "## Token discipline (managed by Obol)",
  "",
  "- Default to concise answers. Skip preamble, restating the question, and",
  "  summaries of what you just did.",
  "- Prefer the shortest correct answer; expand only when asked.",
  "- For routine edits, report the change in a sentence or two, not a walkthrough.",
].join("\n");

/** Short, legible MCP server label (names can be long UUIDs). */
const shortServer = (s: string) => (s.length > 22 ? s.slice(0, 10) + "…" : s);

/**
 * Build the apply plan from a diagnosis. Only "win" findings become actions;
 * "ok"/"info" are nothing to apply. Tier follows the finding's autoApply flag.
 */
export function planApply(
  d: Diagnosis,
  u: UsageSummary,
  cwd: string = process.cwd(),
): ApplyPlan {
  const memoryFile = join(cwd, "CLAUDE.md");
  const actions: ApplyAction[] = [];

  for (const f of d.findings) {
    if (f.severity !== "win") continue;
    actions.push(toAction(f, u, memoryFile));
  }

  // green (writable) first, then amber; within a tier, biggest saving first.
  actions.sort((a, b) =>
    (a.tier === b.tier ? 0 : a.tier === "green" ? -1 : 1) ||
    b.estSaveUSD - a.estSaveUSD);

  return {
    actions,
    green: actions.filter((a) => a.tier === "green"),
    amber: actions.filter((a) => a.tier === "amber"),
    memoryFile,
  };
}

/** Map a single finding to its concrete change. */
function toAction(f: Finding, u: UsageSummary, memoryFile: string): ApplyAction {
  const tier: ApplyAction["tier"] = f.autoApply === "green" ? "green" : "amber";
  const base = {
    techniqueId: f.techniqueId,
    title: f.title,
    tier,
    estSaveUSD: f.estSaveUSD,
  };

  switch (f.techniqueId) {
    case "C1":
      return {
        ...base, kind: "memory-block", target: memoryFile, reversible: true,
        summary: "Append a concise-output block to your project CLAUDE.md.",
        patch: CONCISE_BLOCK,
      };

    case "B1": {
      const servers = u.mcpServers ?? [];
      const invoked = new Set(u.invokedMcpServers ?? []);
      const unused = servers.filter((s) => !invoked.has(s));
      if (unused.length > 0) {
        const list = unused.map(shortServer).join(", ");
        return {
          ...base, kind: "config-edit", target: ".mcp.json / ~/.claude.json", reversible: true,
          summary: `Remove ${unused.length} never-called MCP server${unused.length > 1 ? "s" : ""} that ride the cached prefix on every call.`,
          patch: `Delete from "mcpServers": ${list}`,
        };
      }
      return {
        ...base, kind: "manual", target: "CLAUDE.md + tool/MCP config", reversible: true,
        summary: "Trim the cached prefix (CLAUDE.md, tool defs).",
        patch: f.action,
      };
    }

    case "B3":
      return {
        ...base, kind: "hook", target: "plugin/hooks/reread-guard.mjs", reversible: true,
        summary: "Re-read guard hook warns when a file already in context is read again.",
        patch: "Already shipped in the Obol plugin — install it: /plugin install obol@obol",
      };

    case "A1":
      return {
        ...base, kind: "manual", target: "your request setup", reversible: true,
        summary: "Cache the stable prefix (system prompt, tool defs, long docs).",
        patch: f.action,
      };

    case "D1":
      return {
        ...base, kind: "manual", target: "your routing logic", reversible: true,
        summary: "Route simple work to a cheaper model; keep the frontier model for hard reasoning.",
        patch: f.action,
      };

    default:
      return {
        ...base, kind: "manual", target: "—", reversible: true,
        summary: f.title,
        patch: f.action,
      };
  }
}

/**
 * Write the green, reversible actions. Today that's the CLAUDE.md memory block:
 * all green memory-block patches are merged into ONE managed region, written
 * idempotently between markers (re-running replaces the region, never stacks).
 * Returns one result per green action. Pure local file IO, zero tokens.
 */
export function applyGreen(plan: ApplyPlan): AppliedResult[] {
  const results: AppliedResult[] = [];
  const blocks = plan.green.filter((a) => a.kind === "memory-block");

  if (blocks.length === 0) return results;

  const body = blocks.map((a) => a.patch).join("\n\n");
  const region = `${MARK_START}\n\n${body}\n\n${MARK_END}`;
  const file = plan.memoryFile;

  try {
    let existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    existing = stripRegion(existing); // remove any prior obol region
    const sep = existing.trim() ? existing.replace(/\s+$/, "") + "\n\n" : "";
    writeFileSync(file, sep + region + "\n", "utf8");
    for (const a of blocks) {
      results.push({ techniqueId: a.techniqueId, target: file, ok: true,
        note: "wrote managed CLAUDE.md block (reversible — delete between the obol markers)" });
    }
  } catch (e: any) {
    for (const a of blocks) {
      results.push({ techniqueId: a.techniqueId, target: file, ok: false,
        note: `could not write: ${e?.message ?? e}` });
    }
  }
  return results;
}

/** Remove a previously-written obol region so re-apply is idempotent. */
function stripRegion(text: string): string {
  const start = text.indexOf(MARK_START);
  const end = text.indexOf(MARK_END);
  if (start === -1 || end === -1 || end < start) return text;
  const before = text.slice(0, start);
  const after = text.slice(end + MARK_END.length);
  return (before.replace(/\s+$/, "") + "\n" + after.replace(/^\s+/, "")).trim() + "\n";
}

/**
 * Render the whole plan as a reviewable Markdown doc. The terminal truncates
 * each patch to one line; this is the full, copy-pasteable version — every
 * amber edit spelled out so you can apply it by hand with confidence.
 * Pure string building, zero tokens.
 */
export function renderPlanMarkdown(
  plan: ApplyPlan,
  applied: AppliedResult[] | null = null,
): string {
  const writtenFor = new Set((applied ?? []).filter((r) => r.ok).map((r) => r.techniqueId));
  const date = new Date().toISOString().slice(0, 10);
  const totalSave = plan.actions.reduce((s, a) => s + a.estSaveUSD, 0);
  const out: string[] = [];

  out.push("# Obol — apply plan");
  out.push(`_Generated ${date} · deterministic, zero-token. Estimated savings: up to $${totalSave.toFixed(2)}._`);
  out.push("");

  const section = (title: string, note: string, actions: ApplyAction[]) => {
    if (actions.length === 0) return;
    out.push(`## ${title}`);
    out.push(`_${note}_`);
    out.push("");
    for (const a of actions) {
      const status = a.tier === "green"
        ? (writtenFor.has(a.techniqueId) ? "✓ written" : "ready to write")
        : "needs your approval";
      const save = a.estSaveUSD > 0 ? ` · ~$${a.estSaveUSD.toFixed(2)}/period` : "";
      out.push(`### ${a.techniqueId} — ${a.title}${save}`);
      out.push(a.summary);
      out.push("");
      out.push(`- **Target:** \`${a.target}\``);
      out.push(`- **Type:** ${a.kind}${a.reversible ? " · reversible" : ""}`);
      out.push(`- **Status:** ${status}`);
      out.push("");
      out.push("```");
      out.push(a.patch);
      out.push("```");
      out.push("");
    }
  };

  section("Ready to apply", "green — safe + reversible; `obol --apply` writes these for you", plan.green);
  section("To review", "amber — spelled out exactly, but you approve. Obol never edits live config on its own.", plan.amber);

  if (plan.actions.length === 0) {
    out.push("_Nothing to apply — your usage already looks efficient._");
    out.push("");
  }

  out.push("---");
  out.push("_Reverse a green change any time: delete the block between the `obol:start` / `obol:end` markers in your CLAUDE.md._");
  out.push("");
  return out.join("\n");
}
