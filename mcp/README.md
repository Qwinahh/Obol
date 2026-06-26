# Obol for Claude Desktop (MCP server)

Run Obol's deterministic, zero-token token analyzer **inside the Claude app**. Ask
Claude to *"analyze my token usage"* and a full report appears right in the
conversation — measured cache savings, an efficiency grade, and concrete ways to
spend less. No LLM, no network, nothing sent anywhere, zero tokens spent.

## Install (one click)

1. Download **`obol.mcpb`** (in the repo root).
2. Open **Claude Desktop → Settings → Extensions**.
3. Drag `obol.mcpb` in, or click **Install Extension** and select it.
4. Done. In any chat, say **"analyze my token usage"**.

`.mcpb` is Anthropic's desktop-extension format — a self-contained bundle that
installs the local MCP server in one step. It runs on the Node.js that ships with
Claude Desktop, so there's nothing else to install.

## The tool

`analyze_token_usage` — arguments (all optional):

| arg | type | default | meaning |
|-----|------|---------|---------|
| `demo` | boolean | `false` | Use synthetic sample data instead of your real logs |
| `profile` | `careful` \| `balanced` \| `aggressive` | `balanced` | How aggressively to surface opportunities |
| `dir` | string | — | Path to a Claude Code logs dir, if not in the default location |

It returns a readable markdown briefing **and** the full structured report.

## Privacy

Obol only reads your local Claude Code logs and does deterministic math on them.
It makes no network calls and spends no tokens. The server is **zero-dependency**
— a tiny newline-delimited JSON-RPC loop wrapping the Obol core.

## Rebuilding the bundle

After changing the core (`npm run build` in the repo root), repack with:

```
node mcp/build.js
```

This regenerates `../obol.mcpb` using only Node builtins (no dependencies).

## Layout

```
mcp/server.js     the MCP stdio server (zero deps)
mcp/manifest.json desktop-extension manifest
mcp/build.js      zero-dep packer -> obol.mcpb
obol.mcpb         the installable bundle (manifest + server + dist + data)
```
