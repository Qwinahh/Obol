# Obol Live — floating desktop app

An always-on-top window that shows your Obol token-savings card and keeps it
current while you work. It floats beside Claude (or any AI app), stays put as you
scroll, and refreshes on its own. Zero tokens, runs entirely on your machine.

## Build the app (.exe)

From this folder, once:

```
npm install
npm run dist
```

`npm install` pulls Electron + electron-builder (one-time, a few hundred MB).
`npm run dist` bundles the core and produces installers in `release/`:

- **Obol-Live-Setup-x64.exe** — a one-click installer. Installs the app, adds a
  desktop + Start-menu shortcut. Double-click the shortcut to launch.
- **Obol-Live-0.0.1-portable.exe** — a single portable .exe, no install, just
  double-click to run.

(Run `npm run dist` on Windows so it produces a native Windows .exe.)

## Just run it without packaging

```
npm install
npm start
```

Opens the floating window immediately. Drag it by its body; close it with the ×.

## Launch automatically with Windows (optional)

After building, put a shortcut to the installed app (or the portable .exe) into
the Startup folder: press `Win+R`, type `shell:startup`, and drop the shortcut in.
Now the widget is always there when you log in.

## How it stays live

It refreshes automatically:

- every 20 seconds,
- whenever your Claude Code logs change (it watches `~/.claude/projects`), and
- the instant you run **/analyze** in Claude — the Obol extension drops a signal
  (`~/.obol/live-refresh`) that the widget watches, so it refreshes and pops to
  the front.

## Notes

- It floats as its own always-on-top window beside Claude. It can't embed *inside*
  Claude's window — Claude doesn't allow third-party panels in its UI — but
  always-on-top keeps it visible. As a standalone window it works beside any AI
  app (Claude, Cursor, ChatGPT desktop, etc.).
- Today it analyzes Claude Code's local logs. Other tools that write local usage
  logs can be added later as parsers in the core.
- If you have no Claude Code logs yet, it shows demo data so you can see the design.

## Files

```
main.js        the always-on-top window + live refresh
prepack.js     bundles the core (dist/, data/, card.html, panel.js) for packaging
build/icon.ico app icon (the Obol O)
package.json   electron-builder config (Windows nsis + portable)
```
