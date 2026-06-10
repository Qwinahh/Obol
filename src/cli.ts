#!/usr/bin/env node
import { loadCatalog, autoApplyBreakdown } from "./core/catalog";
import { readUsage } from "./core/usage";
import { diagnose } from "./core/diagnose";
import { proof } from "./core/proof";
import { planApply, applyGreen, renderPlanMarkdown } from "./core/apply";
import type { UsageSummary, Diagnosis } from "./core/types";
import type { Proof } from "./core/proof";
import type { ApplyPlan, AppliedResult } from "./core/apply";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  c, visLen, padEndV, padStartV, fmt, usd, tok,
  chip, bar, stackedBar, sparkline, RULE, WIDTH,
} from "./ui";

const pkg = require("../package.json") as { version: string };

/* ----------------------------- header ----------------------------- */
function banner(): void {
  console.log("\n  " + c.cyan(c.bold("◎ obol")) + "  " + c.dim(`v${pkg.version}`));
  console.log("  " + c.dim("measure · diagnose · cut your token spend — local, deterministic, free") + "\n");
}

function rulesLine(): void {
  const cat = loadCatalog();
  const { green: g, amber: a } = autoApplyBreakdown(cat);
  console.log("  " + c.dim(`rules engine · ${cat.techniques.length} techniques · `) +
    c.green(`${g} auto`) + c.dim(" / ") + c.amber(`${a} review`) + c.dim(` · catalog v${cat.version}`) + "\n");
}

/* ----------------------------- usage ------------------------------ */
function usageReport(u: UsageSummary): void {
  if (!u.found) {
    console.log("  " + c.amber("No Claude Code logs found.") + c.dim("  looked in:"));
    for (const p of u.searchedPaths) console.log("    " + c.dim("· " + p));
    console.log("\n  " + c.dim("logs elsewhere? run:  ") + c.cyan("obol <path-to/projects>") + "\n");
    return;
  }

  const span = u.firstDate && u.lastDate ? `${u.firstDate} → ${u.lastDate}` : "—";
  for (const l of chip(
    c.bold(usd(u.totalCostUSD)) + c.dim(" spent") +
    c.dim("   ·   ") + c.bold(tok(u.totalTokens)) + c.dim(" tokens") +
    c.dim("   ·   ") + c.bold(String(u.sessions)) + c.dim(" sessions")
  )) console.log("  " + l);
  console.log("  " + c.dim("  " + span) + "\n");

  // composition — where the tokens live
  const { line, legend } = stackedBar([
    { label: "cache read", value: u.cacheRead, color: c.cyan },
    { label: "cache write", value: u.cacheWrite, color: c.magenta },
    { label: "input", value: u.input, color: c.green },
    { label: "output", value: u.output, color: c.amber },
  ]);
  console.log("  " + c.dim("where your tokens go"));
  console.log("  " + line);
  console.log("  " + legend + "\n");

  // daily trend
  if (u.byDay.length > 1) {
    const spark = sparkline(u.byDay.map((d) => d.costUSD));
    const peak = u.byDay.reduce((m, d) => (d.costUSD > m.costUSD ? d : m), u.byDay[0]);
    console.log("  " + c.dim("daily spend  ") + c.cyan(spark) +
      c.dim(`   peak ${usd(peak.costUSD)} on ${peak.date}`) + "\n");
  }

  // top sessions
  if (u.bySession.length > 1) {
    console.log("  " + c.bold("Top sessions") + c.dim("  — where spend concentrates"));
    const maxCost = u.bySession[0].costUSD;
    for (const s of u.bySession.slice(0, 4)) {
      const id = (s.id.length > 8 ? s.id.slice(0, 8) : s.id);
      const reads = s.repeatedReads.length ? c.amber(` ⟳${s.repeatedReads.length}`) : "";
      const meta = c.dim(`${s.turns}t · ${tok(s.avgCachePrefix)} prefix`) + reads;
      console.log("  " + c.dim(id.padEnd(9)) + " " + bar(s.costUSD, maxCost, 16, c.cyan) +
        " " + padStartV(usd(s.costUSD), 8) + "  " + meta);
    }
    console.log("");
  }
}

/* ----------------------------- proof ------------------------------ */
function proofReport(p: Proof): void {
  if (!p.hasCacheReceipt) return;
  const cc = p.cache;
  console.log("  " + c.green(c.bold("✓ RECEIPT")) + c.dim("  measured from your logs — not an estimate"));
  console.log("  " + c.dim("caching has already saved you"));
  console.log("  " + c.green(c.bold("  " + usd(cc.savedUSD))) + "  " +
    c.dim(`${Math.round(cc.savedPct)}% off your reused context`));
  console.log("  " + c.dim(`would've cost ${usd(cc.hypotheticalNoCacheUSD)} · actually cost ${usd(cc.actualUSD)} · ${tok(cc.cachedTokens)} reused tokens`) + "\n");
}

/* --------------------------- diagnosis ---------------------------- */
function diagnosisReport(d: Diagnosis, totalSpend: number): void {
  if (d.findings.length === 0) {
    console.log("  " + c.dim("nothing to diagnose yet — ingest some usage first.") + "\n");
    return;
  }

  if (d.alreadyEfficient) {
    console.log("  " + c.green(c.bold("✓ Already running efficiently.")) +
      c.dim(" No material savings found — nice."));
  } else {
    console.log("  " + c.bold("Estimated savings  ") +
      c.green(c.bold("up to " + usd(d.totalEstSaveUSD))) +
      c.dim(`  (~${Math.round(d.totalEstSavePct)}% of ${usd(totalSpend)})`));
    console.log("  " + c.dim("estimates — Step 3 receipts prove them; the Quality Guard will protect them."));
  }
  console.log("");

  const maxSave = Math.max(...d.findings.map((f) => f.estSaveUSD), 0.01);
  for (const f of d.findings) {
    const mark = f.severity === "win" ? c.amber("▲") : f.severity === "ok" ? c.green("✓") : c.dim("•");
    const tag = f.autoApply === "green" ? c.green(" auto") :
                f.autoApply === "amber" ? c.amber(" review") : "";
    const save = f.estSaveUSD > 0 ? c.green(usd(f.estSaveUSD)) : c.dim("—");
    const head = `${mark} ${c.bold(f.title)} ` +
      c.dim(`${f.techniqueId} · ${f.confidence}`) + tag;
    console.log("  " + padEndV(head, WIDTH - 9) + padStartV(save, 9));
    if (f.estSaveUSD > 0) console.log("    " + bar(f.estSaveUSD, maxSave, 20, c.green));
    console.log("    " + f.message);
    console.log("    " + c.dim(f.action) + "\n");
  }
}

/* ----------------------------- apply ------------------------------ */
function applyReport(plan: ApplyPlan, applied: AppliedResult[] | null): void {
  if (plan.actions.length === 0) return;

  console.log("  " + RULE + "\n");
  console.log("  " + c.bold("Apply") + "  " +
    c.green(`${plan.green.length} ready`) + c.dim(" / ") +
    c.amber(`${plan.amber.length} to review`) +
    c.dim("   — green is safe + reversible; amber waits for you") + "\n");

  const writtenFor = new Set((applied ?? []).filter((r) => r.ok).map((r) => r.techniqueId));

  for (const a of plan.actions) {
    const mark = a.tier === "green"
      ? (writtenFor.has(a.techniqueId) ? c.green("✓") : c.green("●"))
      : c.amber("○");
    const tag = a.tier === "green"
      ? (writtenFor.has(a.techniqueId) ? c.green(" written") : c.green(" auto"))
      : c.amber(" review");
    const head = `${mark} ${c.bold(a.title)} ` + c.dim(`${a.techniqueId} · ${a.kind}`) + tag;
    const where = c.dim(shortPath(a.target));
    const gap = Math.max(2, WIDTH - visLen(head) - visLen(where));
    console.log("  " + head + " ".repeat(gap) + where);
    console.log("    " + a.summary);
    console.log("    " + c.dim(a.patch.split("\n")[0] + (a.patch.includes("\n") ? " …" : "")) + "\n");
  }

  if (applied && applied.length) {
    for (const r of applied) {
      const m = r.ok ? c.green("  ✓ ") : c.amber("  ! ");
      console.log(m + c.dim(`${r.techniqueId}: ${r.note}`));
    }
    console.log("");
  } else if (plan.green.length) {
    console.log("  " + c.dim("run  ") + c.cyan("obol --apply") +
      c.dim(`   to write the ${plan.green.length} safe change${plan.green.length > 1 ? "s" : ""} (reversible)`) + "\n");
  }
}

const shortPath = (p: string) => {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
};

/* ------------------------------ args ------------------------------ */
function parseArgs(argv: string[]): { dir?: string; write: boolean; plan: boolean } {
  let dir: string | undefined;
  let write = false;
  let plan = false;
  for (const a of argv) {
    if (a === "--apply" || a === "-a") write = true;
    else if (a === "--plan" || a === "-p") plan = true;
    else if (!a.startsWith("-")) dir = a;
  }
  return { dir, write, plan };
}

/* ------------------------------ run ------------------------------- */
const { dir, write, plan: wantDoc } = parseArgs(process.argv.slice(2));
const usage = readUsage(dir);

banner();
rulesLine();
usageReport(usage);
if (usage.found) {
  console.log("  " + RULE + "\n");
  proofReport(proof(usage));
  const d = diagnose(usage);
  diagnosisReport(d, usage.totalCostUSD);

  const plan = planApply(d, usage);
  const applied = write ? applyGreen(plan) : null;
  applyReport(plan, applied);

  // --plan or --apply: write the full, copy-pasteable review doc next to you.
  if ((write || wantDoc) && plan.actions.length) {
    const docPath = join(process.cwd(), "obol-apply.md");
    try {
      writeFileSync(docPath, renderPlanMarkdown(plan, applied), "utf8");
      console.log("  " + c.dim("full review doc → ") + c.cyan(shortPath(docPath)) + "\n");
    } catch { /* best-effort */ }
  }
}
