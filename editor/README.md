# Obol — Token Optimizer for VS Code

Measure, diagnose, and cut your **Claude Code** token spend without leaving the editor.
Same deterministic engine as the [Obol CLI](https://github.com/Qwinahh/Obol) — **no API key, no tokens spent, nothing leaves your machine.**

## Commands

Open the Command Palette (`Ctrl/Cmd+Shift+P`) and type **Obol**:

- **Obol: Analyze My Token Usage** — reads your `~/.claude/projects` logs and opens a report.
- **Obol: Open Demo Report** — see the full UI on synthetic data, no logs required.
- **Obol: Apply Safe Fixes (reversible)** — writes the green, reversible fixes to your project `CLAUDE.md`.
- **Obol: Run in Terminal (full UI)** — the full ANSI report in the integrated terminal.

## What you get

A single panel: your spend composition, a shareable **efficiency fingerprint**, a measured **cache receipt** (dollars caching already saved you), a prioritized diagnosis of where tokens leak, one-click safe fixes, and a **Quality Guard** plan that proves a fix didn't make answers worse.

The Quality Guard's *live* check is the one feature that ever spends tokens — it is off by default and lives behind `ANTHROPIC_API_KEY` in the CLI.

## Privacy

Everything runs locally and deterministically. Your prompts and logs never leave your computer.

MIT · [github.com/Qwinahh/Obol](https://github.com/Qwinahh/Obol)
