"use strict";
/**
 * Obol leaderboard — reference server (deploy-your-own).
 *
 * Deliberately tiny and dependency-free: Node's http + a JSON file. It exists
 * to show the anti-cheat model end to end, not to be a hosted product. The
 * trust rules live in the shared core (acceptSubmission), so the server and the
 * client agree on exactly one definition of "valid".
 *
 *   POST /submit       body: SignedSubmission  -> { ok, rank?, savedUSD?, reason? }
 *   GET  /leaderboard  ?limit=50               -> { entries: [...] }
 *   GET  /health                                -> { ok: true }
 *
 * Anti-cheat (all enforced here, via the core):
 *   1. signature must verify (Ed25519)
 *   2. name <-> public key is trust-on-first-use; later submits must match
 *   3. the dollar figure is the SERVER's recompute from submitted tokens
 *   4. hard plausibility caps
 *
 * Storage: ./data/leaderboard.json  (git-ignored; never commit real data).
 * No secrets, no env keys required. Configure clients with OBOL_LEADERBOARD_URL.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Resolve the shared core. Prefer a bundled copy; fall back to compiled dist.
function loadCore() {
  const candidates = [
    path.join(__dirname, "core", "index.js"),
    path.join(__dirname, "..", "dist", "index.js"),
    path.join(__dirname, "..", "editor", "dist", "index.js"),
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  throw new Error("obol core not found — run the build, or copy dist into server/core");
}
const core = loadCore();

const DATA_DIR = process.env.OBOL_DATA_DIR || path.join(__dirname, "data");
const DB = path.join(DATA_DIR, "leaderboard.json");
const PORT = parseInt(process.env.PORT || "8787", 10);

function load() {
  try { return JSON.parse(fs.readFileSync(DB, "utf8")); }
  catch (_) { return { names: {}, entries: {} }; } // names: name->pubkey ; entries: name->record
}
function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB, JSON.stringify(db, null, 2) + "\n", "utf8");
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body);
}

function leaderboard(db, limit) {
  const rows = Object.values(db.entries)
    .sort((a, b) => b.savedUSD - a.savedUSD)
    .slice(0, limit)
    .map((e, i) => ({
      rank: i + 1, name: e.name, displayName: e.displayName || e.name,
      savedUSD: e.savedUSD, cachedTokens: e.cachedTokens,
      verified: !!e.verified, updatedAt: e.updatedAt,
    }));
  return rows;
}

function handleSubmit(db, signed) {
  const registered = db.names[signed.submission.name] || null;
  const verdict = core.acceptSubmission(signed, registered);
  if (!verdict.ok) return { code: 400, body: { ok: false, reason: verdict.reason } };

  // TOFU: first submission registers the name's public key.
  if (verdict.registerKey) db.names[signed.submission.name] = verdict.registerKey;

  const s = signed.submission;
  const prev = db.entries[s.name];
  db.entries[s.name] = {
    name: s.name,
    displayName: s.displayName || (prev && prev.displayName) || s.name,
    savedUSD: verdict.savedUSD,        // the server's trusted figure, not the claim
    cachedTokens: s.cachedTokens,
    clientVersion: s.clientVersion,
    verified: prev ? !!prev.verified : false,
    updatedAt: new Date().toISOString(),
  };
  save(db);
  const board = leaderboard(db, 1000);
  const rank = board.findIndex((r) => r.name === s.name) + 1;
  return { code: 200, body: { ok: true, rank, savedUSD: verdict.savedUSD } };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/leaderboard") {
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
    return send(res, 200, { entries: leaderboard(load(), limit) });
  }
  if (req.method === "POST" && url.pathname === "/submit") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
    req.on("end", () => {
      let signed;
      try { signed = JSON.parse(raw); } catch (_) { return send(res, 400, { ok: false, reason: "bad json" }); }
      if (!signed || !signed.submission || !signed.signature || !signed.publicKey)
        return send(res, 400, { ok: false, reason: "missing fields" });
      try {
        const db = load();
        const out = handleSubmit(db, signed);
        return send(res, out.code, out.body);
      } catch (e) {
        return send(res, 500, { ok: false, reason: "server error" });
      }
    });
    return;
  }
  return send(res, 404, { ok: false, reason: "not found" });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`obol leaderboard server on :${PORT}  (db: ${DB})`));
}
module.exports = { server, handleSubmit, leaderboard, load, save };
