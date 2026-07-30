# Shipping Obol

Obol goes out through four channels. Each one is independent — you can ship the
plugin today and the app later.

| Channel | What the user gets | How they install |
|---|---|---|
| Claude Code plugin | The in-session optimiser (modes, routing, live savings) | `/plugin marketplace add Qwinahh/Obol` |
| npm | The `obol` CLI | `npx obol` |
| GitHub Releases | Obol Live desktop app (.exe) + Claude Desktop extension (.mcpb) | Download and run |
| VS Code | The panel inside the editor | `.vsix` (manual for now) |

---

## 1. Claude Code plugin — the main event

This is where the optimiser actually works: Obol reads each prompt, applies your
mode, and reports live savings. It installs straight from the GitHub repo — no
registry, no publish step.

Users run, inside Claude Code:

```
/plugin marketplace add Qwinahh/Obol
/plugin install obol@obol
```

Then restart Claude Code. That's it — hooks are live.

Before tagging a release, verify the loop:

```
npm run build      # bundles dist/ + data/ into plugin/
npm run hooks:test # 9 checks on the optimiser loop
```

Ship it by pushing to `main` (the marketplace reads the repo directly), then tag:

```
git tag v0.1.0 && git push --tags
```

## 2. npm — the CLI

```
npm login
npm publish --access public
```

`prepublishOnly` runs the build, and `files` limits the package to
`dist/ data/ plugin/ README.md LICENSE`. After publishing, anyone can run:

```
npx obol            # analyse this machine's Claude Code usage
npx obol --demo     # see it with sample data
```

Bump the version first (`npm version patch|minor|major`) — npm rejects a
re-publish of an existing version.

## 3. GitHub Releases — the desktop app + Claude extension

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which on a Windows
runner builds:

- `Obol-Live-<version>-x64.exe` — one-click installer for the floating widget
- `Obol-Live-<version>-portable.exe` — no-install version
- `obol.mcpb` — the Claude Desktop extension

and attaches all three to the release. So:

```
npm version patch
git push && git push --tags
```

…and the artifacts appear on the Releases page a few minutes later. To build
locally instead:

```
node mcp/build.js            # -> obol.mcpb
cd widget && npm run dist    # -> widget/release/*.exe
```

## 4. VS Code extension

```
cd editor
npx @vscode/vsce package     # -> obol-<version>.vsix
```

Publishing to the Marketplace needs a publisher account and
`npx @vscode/vsce publish`. The `.vsix` can be shared directly in the meantime.

---

## Release checklist

1. `npm run build`
2. `npm run hooks:test` — 9/9
3. `node dist/cli.js --demo` — renders
4. Bump the version in `package.json` **and** `plugin/.claude-plugin/plugin.json`
5. Commit, push, tag `vX.Y.Z`
6. Confirm the workflow attached the `.exe` + `.mcpb`
7. `npm publish --access public`

## Notes

- Nothing here needs an API key. Obol is deterministic and local; the only
  optional token-spending feature is Quality Guard, which stays off by default.
- The plugin, CLI, widget and extension all share one core (`src/core`), so a
  fix in the maths lands everywhere on the next build.
