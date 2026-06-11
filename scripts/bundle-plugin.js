#!/usr/bin/env node
// Make the plugin/ and editor/ surfaces self-contained so each can be copied
// (Claude Code's install-copy; a packaged .vsix) and still find the built CLI,
// the rules data, and the version string at runtime — no references to ../dist.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

// Overwrite-in-place copy. We try a clean wipe first, but some filesystems
// (network/mounted drives) reject the recursive unlink with EPERM — so we fall
// back to copying over the top, which never deletes and always succeeds.
function syncDir(from, to) {
  try { fs.rmSync(to, { recursive: true, force: true }); } catch { /* EPERM on some mounts — copy over instead */ }
  fs.cpSync(from, to, { recursive: true, force: true });
}

for (const dir of ["dist", "data"]) {
  if (!fs.existsSync(path.join(root, dir))) {
    console.error(`bundle-plugin: missing ${dir}/ — run the build first.`);
    process.exit(1);
  }
}

// Claude Code plugin: dist/ + data/ + a package.json (cli.js reads its version).
const plugin = path.join(root, "plugin");
syncDir(path.join(root, "dist"), path.join(plugin, "dist"));
syncDir(path.join(root, "data"), path.join(plugin, "data"));
fs.copyFileSync(path.join(root, "package.json"), path.join(plugin, "package.json"));

// VS Code extension: dist/ + data/. The extension keeps its OWN package.json
// (the manifest), which already carries a version field for cli.js to read.
const editor = path.join(root, "editor");
if (fs.existsSync(editor)) {
  syncDir(path.join(root, "dist"), path.join(editor, "dist"));
  syncDir(path.join(root, "data"), path.join(editor, "data"));
}

console.log("bundle-plugin: plugin + editor (dist, data) refreshed.");
