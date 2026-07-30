#!/usr/bin/env node
/* Verifies the Obol in-session optimiser loop end to end. Zero tokens, no network. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS = join(ROOT, "plugin", "hooks");
const HOME = mkdtempSync(join(tmpdir(), "obol-test-"));
const env = { ...process.env, HOME, USERPROFILE: HOME };
const S = join(HOME, ".obol", "session.json");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? (pass++, console.log("  ok   " + name)) : (fail++, console.log("  FAIL " + name + (extra ? "  " + extra : ""))); };
const run = (script, payload) => execFileSync("node", [join(HOOKS, script)], { input: JSON.stringify(payload), env, encoding: "utf8" });
const state = () => JSON.parse(readFileSync(S, "utf8"));

console.log("\nObol hook loop\n");

// 1. classification + auto mode
let out = run("router.mjs", { session_id: "t1", cwd: "/x/beacon", prompt: "fix the typo in readme.md" });
ok("router injects a directive", /additionalContext/.test(out));
ok("simple prompt -> careful", state().mode === "careful", state().mode);
ok("project name captured", state().project === "beacon", state().project);

run("router.mjs", { session_id: "t1", cwd: "/x/beacon", prompt: "refactor the auth module and debug the race condition in worker.ts and pool.ts" });
ok("complex prompt -> aggressive", state().mode === "aggressive", state().mode);

// 2. explicit user choice wins over the recommendation
mkdirSync(join(HOME, ".obol"), { recursive: true });
writeFileSync(join(HOME, ".obol", "mode.json"), JSON.stringify({ mode: "careful" }));
run("router.mjs", { session_id: "t1", cwd: "/x/beacon", prompt: "write the entire billing service from scratch" });
ok("user pick overrides auto", state().mode === "careful" && state().recommended === "aggressive");

// 3. escape hatch
const skipped = run("router.mjs", { session_id: "t1", cwd: "/x/beacon", prompt: "~ leave me alone" });
ok("~ prefix bypasses Obol", skipped.trim() === "");

// 4. live savings measurement + ledger
const tp = join(HOME, "t.jsonl");
writeFileSync(tp, JSON.stringify({ message: { model: "claude-sonnet-4-5", usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 4000, cache_read_input_tokens: 30000 } } }) + "\n");
run("session-tracker.mjs", { session_id: "t1", transcript_path: tp });
const first = state().savedUSD;
ok("session savings measured", first > 0, "$" + first);

writeFileSync(tp, readFileSync(tp, "utf8") + JSON.stringify({ message: { model: "claude-sonnet-4-5", usage: { input_tokens: 800, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 52000 } } }) + "\n");
run("session-tracker.mjs", { session_id: "t1", transcript_path: tp });
ok("savings rise as work continues", state().savedUSD > first, "$" + first + " -> $" + state().savedUSD);

const ledger = JSON.parse(readFileSync(join(HOME, ".obol", "ledger.json"), "utf8"));
ok("ledger accrues without double counting", Math.abs(ledger.allTime - state().savedUSD) < 1e-9, "$" + ledger.allTime);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
