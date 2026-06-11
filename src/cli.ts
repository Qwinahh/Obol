#!/usr/bin/env node
import { loadCatalog, autoApplyBreakdown } from "./core/catalog";
import { readUsage } from "./core/usage";
import { demoUsage } from "./core/demo";
import { diagnose } from "./core/diagnose";
import { proof } from "./core/proof";
import { planApply, applyGreen, renderPlanMarkdown } from "./core/apply";
import { planGuard, runGuard, anthropicCaller, shortModel } from "./core/guard";
import { fingerprint } from "./core/fingerprint";
import { recommend } from "./core/recommend";
import { buildReport } from "./core/report";
import type { UsageSummary, Diagnosis } from "./core/types";
import type { Proof } from "./core/proof";
import type { ApplyPlan, AppliedResult } from "./core/apply";
import type { GuardPlan, GuardVerdict } from "./core/guard";
import type { NextStep } from "./core/recommend";
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
    console.log("\n  " + c.dim("logs elsewhere? run:  ") + c.cyan("obol <path-to/projects>"));
    console.log("  " + c.dim("just kicking the tyres? run:  ") + c.cyan("obol --demo") + "\n");
    return;
  }

  const span = u.firstDate && u.lastDate ? `${u.firstDate} → ${u.lastDate}` : "—";
  for (const l of chip(
    c.bold(usd(u.totalCostUSD)) + c.dim(" spent") +
    c.dim("   ·   ") + c.bold(tok(u.totalTokens)) + c.dim(" tokens") +
    c.dim("   ·   ") + c.bold(String(u.sessions)) + c.dim(" sessions")
  )) console.log("  " + l);
  const tag = u.source === "demo://synthetic-usage" ? c.magenta("  demo data") : "";
  console.log("  " + c.dim("  " + span) + tag + "\n");

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

/* --------------------------- fingerprint -------------------------- */
function fingerprintReport(u: UsageSummary): void {
  const f = fingerprint(u);
  const col = f.score >= 80 ? c.green : f.score >= 55 ? c.amber : c.red;
  console.log("  " + c.dim("fingerprint  ") + col(c.bold(f.traits.join(" · "))) +
    c.dim("   efficiency ") + col(c.bold(`${f.score}/100`)) + col(` ${f.grade}`));
  console.log("  " + bar(f.score, 100, 28, col) + c.dim("   share me ↑") + "\n");
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
    console.log("  " + c.dim("estimates — Step 3 receipts prove them; the Quality Guard protects them."));
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

/* --------------------------- recommend ---------------------------- */
function recommendReport(steps: NextStep[]): void {
  if (steps.length === 0) return;
  console.log("  " + c.bold("Do this next") + c.dim("  — biggest, easiest wins first") + "\n");
  for (const s of steps) {
    const col = s.tier === "green" ? c.green : c.amber;
    const save = s.estSaveUSD > 0 ? c.green("up to " + usd(s.estSaveUSD)) : c.dim("—");
    const head = "  " + col(c.bold(`${s.rank}. ${s.title}`)) + c.dim("  " + s.effort);
    const gap = Math.max(2, WIDTH - visLen(head) - visLen(save));
    console.log(head + " ".repeat(gap) + save);
    console.log("     " + c.dim(s.detail) + "\n");
  }
}

/* ------------------------------ guard ----------------------------- */
function guardReport(plan: GuardPlan, verdicts: GuardVerdict[] | null): void {
  if (plan.probes.length === 0) return;
  console.log("  " + RULE + "\n");
  console.log("  " + c.bold("Quality Guard") + c.dim("  — prove a fix didn't make answers worse") + "\n");

  // provably-safe fixes pass for free
  for (const p of plan.safe) {
    console.log("  " + c.green("✓ ") + c.bold(p.title) + c.dim(`  ${p.techniqueId}`) +
      c.green("  proven safe · $0"));
    console.log("    " + c.dim(p.rationale) + "\n");
  }

  const verdictFor = new Map((verdicts ?? []).map((v) => [v.techniqueId, v]));

  for (const p of plan.replay) {
    const v = verdictFor.get(p.techniqueId);
    if (v && v.ran) {
      const ok = v.passed;
      const mark = ok ? c.green("✓ ") : c.red("✗ ");
      const tagc = ok ? c.green : c.red;
      console.log("  " + mark + c.bold(p.title) + c.dim(`  ${p.techniqueId}`) +
        tagc(`  ${Math.round(v.score * 100)}% canaries held`));
      console.log("    " + c.dim(v.note) + "\n");
    } else if (v && !v.ran) {
      console.log("  " + c.amber("! ") + c.bold(p.title) + c.dim(`  ${p.techniqueId}`) +
        c.amber("  guard couldn't run"));
      console.log("    " + c.dim(v.note) + "\n");
    } else {
      console.log("  " + c.amber("○ ") + c.bold(p.title) + c.dim(`  ${p.techniqueId}`) +
        c.dim(`  needs a canary check · est `) + c.amber(gcost(p.estCostUSD)));
      console.log("    " + c.dim(p.rationale) + "\n");
    }
  }

  for (const p of plan.manual) {
    console.log("  " + c.dim("· ") + c.bold(p.title) + c.dim(`  ${p.techniqueId}  —  ${p.rationale}`) + "\n");
  }

  // the one paid path, explained honestly
  if (plan.replay.length && !verdicts) {
    if (plan.hasKey) {
      console.log("  " + c.dim("run  ") + c.cyan("obol --guard") +
        c.dim(`   to verify the routing fixes live (~${gcost(plan.estCostUSD)}, your key, tiny prompts)`) + "\n");
    } else {
      console.log("  " + c.dim("the guard's live check is the one feature that spends tokens — it's off by default."));
      console.log("  " + c.dim("set ") + c.cyan("ANTHROPIC_API_KEY") + c.dim(" and run ") +
        c.cyan("obol --guard") + c.dim(` to run it (~${gcost(plan.estCostUSD)}). everything above stayed $0.`) + "\n");
    }
  }
}

const gcost = (n: number) => (n <= 0 ? "$0.00" : n < 0.01 ? "<$0.01" : usd(n));
const shortPath = (p: string) => {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
};

/* ------------------------------ args ------------------------------ */
interface Args { dir?: string; write: boolean; plan: boolean; demo: boolean; guard: boolean; json: boolean; }
function parseArgs(argv: string[]): Args {
  const a: Args = { write: false, plan: false, demo: false, guard: false, json: false };
  for (const arg of argv) {
    if (arg === "--apply" || arg === "-a") a.write = true;
    else if (arg === "--plan" || arg === "-p") a.plan = true;
    else if (arg === "--demo" || arg === "-d") a.demo = true;
    else if (arg === "--guard" || arg === "-g") a.guard = true;
    else if (arg === "--json" || arg === "-j") a.json = true;
    else if (!arg.startsWith("-")) a.dir = arg;
  }
  return a;
}

/* ------------------------------ run ------------------------------- */
async function main(): Promise<void> {
  const { dir, write, plan: wantDoc, demo, guard: wantGuard, json } = parseArgs(process.argv.slice(2));
  const usage = demo ? demoUsage() : readUsage(dir);

  // --json: emit the full report as machine-readable data (used by the VS Code
  // extension and anyone scripting Obol). Still 100% deterministic + zero-token.
  if (json) {
    process.stdout.write(JSON.stringify(buildReport(usage, pkg.version), null, 2) + "\n");
    return;
  }

  banner();
  rulesLine();
  usageReport(usage);
  if (!usage.found) return;

  fingerprintReport(usage);
  console.log("  " + RULE + "\n");
  proofReport(proof(usage));

  const d = diagnose(usage);
  diagnosisReport(d, usage.totalCostUSD);

  const applyPlan = planApply(d, usage);
  const applied = write ? applyGreen(applyPlan) : null;
  applyReport(applyPlan, applied);

  recommendReport(recommend(d, applyPlan));

  // Step 4 — the Quality Guard. Plan is always free. The live check is opt-in.
  const gplan = planGuard(applyPlan, usage);
  let verdicts: GuardVerdict[] | null = null;
  if (wantGuard && gplan.hasKey && gplan.replay.length) {
    verdicts = await runGuard(gplan, anthropicCaller(process.env.ANTHROPIC_API_KEY as string));
  }
  guardReport(gplan, verdicts);

  // --plan or --apply: write the full, copy-pasteable review doc next to you.
  if ((write || wantDoc) && applyPlan.actions.length) {
    const docPath = join(process.cwd(), "obol-apply.md");
    try {
      writeFileSync(docPath, renderPlanMarkdown(applyPlan, applied), "utf8");
      console.log("  " + c.dim("full review doc → ") + c.cyan(shortPath(docPath)) + "\n");
    } catch { /* best-effort */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
