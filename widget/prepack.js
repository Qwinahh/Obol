"use strict";
// Copy the deterministic core + card into this folder so the packaged app is
// self-contained (no dependency on the parent repo layout). Run before packaging.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.endsWith(".d.ts")) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
copyDir(path.join(ROOT, "dist"), path.join(__dirname, "dist"));
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
for (const f of ["pricing.json", "catalog.json"]) fs.copyFileSync(path.join(ROOT, "data", f), path.join(__dirname, "data", f));
fs.copyFileSync(path.join(ROOT, "mcp", "card.html"), path.join(__dirname, "card.html"));
fs.copyFileSync(path.join(ROOT, "mcp", "panel.js"), path.join(__dirname, "panel.js"));
console.log("prepack: bundled dist/, data/, card.html, panel.js into widget/");
