#!/usr/bin/env node
// Make plugin/ self-contained so Claude Code's install-copy carries everything.
// Claude Code copies the plugin directory to a cache; references to ../dist would
// break. So we copy the built CLI (dist/), the rules data (data/), and package.json
// *into* the plugin, preserving the dist/core -> ../../data layout and the
// dist/cli.js -> ../package.json version read that the CLI does at runtime.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const plugin = path.join(root, "plugin");

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

for (const dir of ["dist", "data"]) {
  const from = path.join(root, dir);
  if (!fs.existsSync(from)) {
    console.error(`bundle-plugin: missing ${dir}/ — run the build first.`);
    process.exit(1);
  }
  copyDir(from, path.join(plugin, dir));
}

// cli.js does require("../package.json") for its version string.
fs.copyFileSync(path.join(root, "package.json"), path.join(plugin, "package.json"));

console.log("bundle-plugin: plugin/dist, plugin/data, plugin/package.json refreshed.");
