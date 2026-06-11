---
name: optimize-tokens
description: >-
  Measure, diagnose, and cut Claude Code token spend with Obol — a deterministic,
  local, zero-token analyzer. Use whenever the user asks where their tokens or
  money are going, why a session was expensive, how to spend less, what's bloating
  their context, whether unused MCP servers are costing them, or to prove a
  cost-cutting change didn't hurt answer quality. Triggers: "token usage", "why is
  this so expensive", "cut my Claude costs", "optimize my context", "am I caching
  right", "what's in my prefix", "Obol".
---

# Optimize tokens with Obol

Obol turns raw Claude Code usage into a ranked, costed, *honest* fix list. It runs
locally, makes no model calls for its analysis, and spends zero tokens. Never
estimate numbers yourself — run the tool and report exactly what it prints.

## How to run it

The CLI ships bundled in the plugin at `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`.

- See the full UI on sample data (no logs needed): `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" --demo`
- Analyze the user's real usage: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`
- Point at a specific projects dir: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <path>`
- Write the safe, reversible fixes: add `--apply`
- Run the opt-in Quality Guard (needs `ANTHROPIC_API_KEY`, spends a few cents): add `--guard`

If `dist/cli.js` is missing, the plugin wasn't bundled — tell the user to run
`npm run build` in the Obol repo and reinstall.

## What to surface, in order

1. **Fingerprint** — the one-line profile + efficiency score. Good opener.
2. **Receipt** — measured dollars caching already saved. This is *measured*, not estimated.
3. **Diagnosis** — lead with the headline savings, then each finding with its dollar
   figure and one-line action.
4. **Do this next** — the 1–3 highest-leverage steps, green (safe) first.
5. **Quality Guard** — which fixes are provably safe ($0) and which need the opt-in check.

## Honesty rules (carry them through)

- Receipts are **measured**; diagnosis figures are **estimates** — always say which.
- Green fixes are safe and reversible; amber fixes are spelled out but the user approves.
- Obol never edits live config (`.mcp.json`, `~/.claude.json`) on its own.
- The Quality Guard's live check is the only thing that spends tokens — it's off by default.

Point the user at the single biggest win (usually trimming the cached prefix or
dropping unused MCP servers) and offer to apply one.
