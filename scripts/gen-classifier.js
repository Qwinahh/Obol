#!/usr/bin/env node
/* Generates mcp/classify.js (CommonJS) from plugin/hooks/classify.mjs so the
   Claude app and Claude Code always classify prompts identically. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "plugin", "hooks", "classify.mjs"), "utf8");
const out = src
  .replace(/^export function /m, "function ")
  .replace(/^export const /m, "const ")
  + "\nmodule.exports = { classify, DIRECTIVES };\n";
fs.writeFileSync(path.join(ROOT, "mcp", "classify.js"), "/* GENERATED from plugin/hooks/classify.mjs — edit that file, not this one. */\n" + out);
console.log("generated mcp/classify.js");
