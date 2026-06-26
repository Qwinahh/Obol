#!/usr/bin/env node
/*
 * build.js — pack the Obol MCP server into obol.mcpb (a Claude Desktop extension).
 *
 * Zero dependencies: a .mcpb is just a ZIP with manifest.json at the root.
 * We assemble { manifest.json, server/, dist/, data/ } and DEFLATE them into
 * ../obol.mcpb using only Node builtins (zlib + a tiny ZIP writer).
 *
 * Run after `npm run build` in the repo root so dist/ is current:
 *   node mcp/build.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "obol.mcpb");

/* ---- CRC32 ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---- collect files (relative path -> absolute source) ---- */
function walk(dir, base, into) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, base, into);
    else if (!name.endsWith(".d.ts")) into.push({ zip: path.relative(base, abs).split(path.sep).join("/"), abs });
  }
}

const files = [];
// manifest.json must be first
files.push({ zip: "manifest.json", abs: path.join(__dirname, "manifest.json") });
files.push({ zip: "server/server.js", abs: path.join(__dirname, "server.js") });
files.push({ zip: "server/panel.js", abs: path.join(__dirname, "panel.js") });
files.push({ zip: "server/card.html", abs: path.join(__dirname, "card.html") });
files.push({ zip: "server/bridge.bundle.js", abs: path.join(__dirname, "bridge.bundle.js") });
walk(path.join(ROOT, "dist"), ROOT, files);
files.push({ zip: "data/pricing.json", abs: path.join(ROOT, "data", "pricing.json") });
files.push({ zip: "data/catalog.json", abs: path.join(ROOT, "data", "catalog.json") });

/* ---- write ZIP (DEFLATE) ---- */
const locals = [];
const central = [];
let offset = 0;
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0, 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };

for (const f of files) {
  const data = fs.readFileSync(f.abs);
  const comp = zlib.deflateRawSync(data);
  const crc = crc32(data);
  const name = Buffer.from(f.zip, "utf8");
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0),
    name, comp,
  ]);
  locals.push(local);
  central.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(comp.length), u32(data.length),
    u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
    name,
  ]));
  offset += local.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(centralBuf.length), u32(offset), u16(0),
]);
fs.writeFileSync(OUT, Buffer.concat([...locals, centralBuf, end]));
console.log("Packed " + files.length + " files -> " + OUT + " (" + fs.statSync(OUT).size + " bytes)");
