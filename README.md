# ◎ Obol

**Measure, diagnose, and cut your LLM token spend — deterministic, local, free.**

## Why it's different

Most tools either *just show you a number* (ccusage and the usage monitors) or are
*engineering infrastructure* you wire into app code (LiteLLM, Langfuse). Obol owns the
middle: **measure → diagnose *why* it was wasteful → explain it plainly → apply the fix →
prove the answer didn't get worse.** For everyday users, across Claude Code, chat, and
VS Code.

It's **free and deterministic** because the analysis is math over a maintained technique
catalog - no model is ever in the loop. That's the same property that makes it instant,
private, and repeatable. The constraint is the moat.

## Status

Built one step at a time. **Step 0 (this commit): the foundation runs.**

- [x] Step 0 — repo skeleton, technique catalog wired in as the rules engine, CLI runs
- [x] Step 1 — read your real Claude Code session logs
- [x] Step 2 — diagnose against the catalog (ranked, costed fix list)
- [x] Step 3 — the Proof Engine (measured receipt: dollars caching already saved)
- [ ] Step 4 — the Quality Guard (savings *and* a quality score)
- [x] Step 5 — lives inside Claude Code (`/optimize` command + re-read guard hook)
- [x] Step 6 — the satisfying visual layer (chips, bars, sparklines, receipt hero)
- [ ] Steps 7–11 — waste fingerprint, circuit breaker, Skill, VS Code, recommender

## Run it

```bash
npm install
npm run build
npm start            # measure + diagnose (read-only)
npm start -- --apply # also write the safe, reversible fixes
```

`--apply` writes only the **green** changes — today, a clearly-marked, reversible block in
your project `CLAUDE.md`. **Amber** fixes (e.g. dropping unused MCP servers) are spelled out
exactly but left for you to approve; Obol never edits live config on its own.

## Use it inside Claude Code

The `plugin/` directory is a Claude Code plugin, exposed through a local marketplace
(`.claude-plugin/marketplace.json`). `npm run build` bundles the compiled CLI and the
rules catalog *into* the plugin so it's self-contained when Claude Code copies it on
install. From this repo root:

```bash
npm install
npm run build            # builds + bundles the plugin
```

Then in Claude Code:

```
/plugin marketplace add ./        # point it at this repo (the marketplace lives here)
/plugin install obol@obol         # install the plugin
```

Now you have:

- `/obol:optimize` — runs the analyzer and shows the **Receipts** + **Diagnosis** inline.
- A **re-read guard** hook fires before each `Read`: if a file was already read this
  session, it reminds Claude (non-blocking) so you stop re-billing tokens you already have.

The hook never blocks a read — worst case it does nothing. Both run locally, zero tokens.
Re-run `npm run build` after any code change and `/plugin marketplace update obol` to refresh.

## Architecture

One deterministic **core** (`src/core`), many faces. The catalog (`data/catalog.json`)
is the rules engine — the single most important file to keep current.

MIT licensed.

## Secu
