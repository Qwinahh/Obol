# ◎ Obol

**Measure, diagnose, and cut your Claude Code token spend — deterministic, local, free.**

![license](https://img.shields.io/badge/license-MIT-black)
![dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![tokens used](https://img.shields.io/badge/tokens%20to%20analyze-0-blue)
![analysis](https://img.shields.io/badge/analysis-deterministic-purple)
![works offline](https://img.shields.io/badge/network-not%20required-lightgrey)

An *obol* was the smallest coin of the ancient Greek world — the single tiny unit of
currency you actually spent. A token is an obol. Obol watches where yours go, tells you
*why* they're wasted, fixes what's safe to fix, and proves your answers didn't get worse.

No API key. No account. No model in the loop. It reads the logs Claude Code already keeps
on your machine and does the rest with math.

---

## See it in 10 seconds

No logs yet? Run the built-in demo — one command, the whole UI, zero setup:

```bash
git clone https://github.com/Qwinahh/Obol.git
cd Obol && npm install && npm run build
npm start -- --demo
```

```
  ◎ obol  v0.0.1
  measure · diagnose · cut your token spend — local, deterministic, free

  ╭──────────────────────────────────────────────────────────╮
  │ $96.95 spent   ·   22.1M tokens   ·   6 sessions          │
  ╰──────────────────────────────────────────────────────────╯

  fingerprint  Opus-heavy · Verbose-output · Cache-leaky   efficiency 56/100 D
  ████████████████░░░░░░░░░░░░   share me ↑

  ✓ RECEIPT  measured from your logs — not an estimate
    $34.98  70% off your reused context        (caching already saved this)

  Estimated savings  up to $33.56  (~35% of $96.95)

  ▲ Prompt caching   A1   Only 52% of your input is cached      $16.47
  ▲ Model tiering    D1   80% of spend is on Opus                $9.35
  ▲ Output discipline C1  Output is 47% of spend (~5x input)     $6.79
  ▲ Bloated context  B1   4 of 6 MCP servers never called        $0.83

  Do this next  — biggest, easiest wins first
  1. Output discipline   1 min · safe + reversible   up to $6.79
  2. Prompt caching      review first                up to $16.47

  Quality Guard  — prove a fix didn't make answers worse
  ✓ Prompt caching   proven safe · $0
  ○ Model tiering    needs a canary check · est <$0.01
```

(Then point it at your real usage: just `npm start`.)

---

## Why it's different

Most tools either **just show you a number** (ccusage, the usage monitors) or are
**engineering infrastructure** you wire into application code (LiteLLM, Langfuse). Obol
owns the middle, and goes the whole way:

> **measure → diagnose *why* it was wasteful → explain it plainly → apply the fix → prove the answer didn't get worse.**

It's **free, instant, private, and repeatable** for one reason: the analysis is math over a
maintained technique catalog — **no model is ever in the loop.** That single constraint is
the moat. It's what lets Obol run with zero tokens, no key, and no data leaving your machine.

The *one* feature that ever spends a token is the opt-in Quality Guard — and even that is
off by default, uses your own key, and runs tiny prompts. Everything else is $0, always.

---

## What it does

| | Step | What you get |
|---|---|---|
| ✅ | **Measure** | Reads your real Claude Code logs — spend by model, by day, by session. |
| ✅ | **Fingerprint** | A one-line shareable profile + efficiency score out of 100. |
| ✅ | **Receipt** | *Measured* dollars prompt caching has already saved you. Not an estimate. |
| ✅ | **Diagnose** | A ranked, costed fix list against the technique catalog, with confidence tags. |
| ✅ | **Recommend** | "Do this next" — the 1–3 highest-leverage wins, easiest first. |
| ✅ | **Apply** | Writes the safe, reversible fixes; spells out the rest for you to approve. |
| ✅ | **Quality Guard** | Proves a cost-cutting change didn't degrade answers (opt-in, your key). |

Four kinds of waste, every technique mapped to exactly one: re-sent context (caching),
unneeded context (trimming), verbose output (output discipline), wrong route (model
tiering / batching).

---

## Apply: green vs amber

```bash
npm start -- --apply   # write the safe changes; print the rest
```

- **Green** — safe and reversible. Obol writes it for you as a clearly-marked, deletable
  block in your project `CLAUDE.md`.
- **Amber** — detected and spelled out exactly, but **you** approve it. Obol **never** edits
  live config (`.mcp.json`, `~/.claude.json`) on its own.

`--apply` (or `--plan`) also drops a full, copy-pasteable `obol-apply.md` review doc next to you.

---

## The Quality Guard

The promise that separates Obol from every "here's a cheaper number" tool: after you change
something to save money, **prove the answers didn't get worse.**

- **Provably-safe fixes pass for free.** Caching the same content, dropping an MCP server
  that logged *zero* calls, a warn-only hook — these can't change any answer, so the guard
  passes them at **$0** with a one-line proof.
- **Behaviour-affecting fixes get checked.** Routing work to a cheaper model, or asking for
  concise answers, *could* change outputs — so the guard runs a small suite of checkable
  canary tasks through the proposed config and confirms correctness holds.

```bash
export ANTHROPIC_API_KEY=...   # the only feature that ever needs this
npm start -- --guard           # ~a fraction of a cent; off by default
```

With no key, the guard prints exactly what it *would* run and the estimated cost, and stays $0.

---

## Use it inside Claude Code

The `plugin/` directory is a Claude Code plugin, exposed through a local marketplace.
`npm run build` bundles the compiled CLI and the rules catalog *into* the plugin so it's
self-contained when Claude Code copies it on install.

```
/plugin marketplace add ./        # point it at this repo
/plugin install obol@obol         # install the plugin
```

You get:

- **`/obol:optimize`** — runs the analyzer inline (Receipts + Diagnosis + Do-this-next).
- An **`optimize-tokens` skill** — so Claude reaches for Obol whenever you ask where your
  tokens are going.
- A **re-read guard** hook — fires before each `Read`; if a file's already in context, it
  reminds Claude (non-blocking) so you stop re-billing tokens you have.
- A **circuit breaker** hook — when a session's measured spend crosses a threshold, it nudges
  you once: long sessions quietly re-bill a bloated prefix.

Every hook is fail-safe: worst case, it does nothing. All local, all zero-token.

---

## Use it inside VS Code

The `editor/` directory is a VS Code extension built on the same deterministic core — no API
key, no tokens, nothing leaves your machine. `npm run build` bundles the compiled core and the
rules catalog into it.

Open the Command Palette and type **Obol**:

- **Analyze My Token Usage** — reads your logs and opens the report panel.
- **Open Demo Report** — the full UI on synthetic data, no logs required.
- **Apply Safe Fixes (reversible)** — writes the green fixes to your project `CLAUDE.md`.
- **Run in Terminal (full UI)** — the full ANSI report in the integrated terminal.

The panel is the same five surfaces as the CLI — composition, fingerprint, receipt, diagnosis,
do-this-next, and the Quality Guard plan — rendered as a clickable report.

---

## Scripting

Every surface builds from one report object. Get it as JSON for your own dashboards or CI:

```bash
npm start -- --json          # the whole report: usage, fingerprint, proof, diagnosis, apply, guard
npm start -- --demo --json   # same shape, on synthetic data
```

---

## Privacy

Obol's analysis never makes a network call and never sends your prompts anywhere — it reads
local log files and does arithmetic. No key is needed for anything except the opt-in Quality
Guard, which is off by default and uses your own key for tiny canary prompts. Your `.env` is
git-ignored; `.env.example` shows the optional key without a value.

---

## Roadmap

Built one honest step at a time.

- [x] Steps 0–3 — skeleton, log reader, diagnosis, the Proof Engine
- [x] Step 4 — the **Quality Guard** (provably-safe fixes free; behaviour-affecting fixes canary-checked)
- [x] Steps 5–6 — Claude Code plugin (`/optimize`, re-read guard) + the satisfying visual layer
- [x] Step 7 — the **waste fingerprint** (shareable profile + score)
- [x] Step 8 — the **circuit breaker** hook
- [x] Step 9 — the **optimize-tokens skill**
- [x] Step 10 — a **VS Code extension** (the same core, in your editor)
- [x] Step 11 — the **recommender** (do-this-next)

Every planned step is shipped.

---

## Architecture

One deterministic **core** (`src/core`), many faces (CLI, Claude Code plugin, VS Code extension).
The catalog (`data/catalog.json`) is the rules engine — the single most important file to keep
current. Zero runtime dependencies.

If Obol saved you something, a ⭐ helps other people find it.

MIT licensed.
