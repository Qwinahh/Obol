---
description: Run Obol on your Claude Code usage — measured receipts + a ranked, costed fix list.
argument-hint: "[optional path to a projects/ dir]"
allowed-tools: Bash(node:*), Bash(npm:*)
---

You are running **Obol**, a deterministic, local, zero-token analyzer of Claude Code token spend. Do not estimate any numbers yourself — run the tool and report exactly what it prints.

## Steps

1. Resolve the Obol CLI. It ships bundled inside the plugin at `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`.
   - If that file does not exist, the plugin wasn't bundled — tell the user to run `npm run build` in the Obol repo (the build bundles the CLI into the plugin) and reinstall.
2. Run the analyzer:
   - If the user passed a path argument (`$ARGUMENTS`), run: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" $ARGUMENTS`
   - Otherwise run: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`
3. Present the output to the user, preserving Obol's structure:
   - The **Receipts** panel first (measured — money caching already saved).
   - Then the **Diagnosis**: lead with the headline savings number, then each finding with its dollar figure and one-line action.
4. Keep your summary tight. Obol already formatted the detail — point the user at the top 1–2 wins and the single highest-leverage action (usually trimming the cached prefix or cutting unused MCP servers). Offer to help apply one.

## Honesty rules (carry them through)

- Receipts are **measured**; the diagnosis numbers are **estimates** — say which is which.