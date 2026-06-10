#!/usr/bin/env node
/**
 * Obol re-read guard — the circuit-breaker seed (Step 8 preview).
 *
 * Fires before every Read. If a file has already been read in this session, it
 * gently tells Claude (non-blocking) that the content is likely already in
 * context — the exact waste Obol's diagnosis flags ("main.py read 11x").
 *
 * Fail-safe by design: it NEVER blocks a Read. Any error, any odd input, and it
 * exits 0 silently. The worst case is that it does nothing.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function main() {
  const raw = readStdin();
  let evt;
  try { evt = JSON.parse(raw); } catch { return; }

  const path = evt?.tool_input?.file_path ?? evt?.tool_input?.path;
  if (typeof path !== "string" || !path) return;

  const session = String(evt?.session_id ?? "default").replace(/[^A-Za-z0-9_.-]/g, "_");
  const dir = join(tmpdir(), "obol-reread");
  const store = join(dir, `${session}.json`);

  let seen = {};
  try { if (existsSync(store)) seen = JSON.parse(readFileSync(store, "utf8")); } catch { seen = {}; }

  const prior = seen[path] ?? 0;
  seen[path] = prior + 1;
  try { mkdirSync(dir, { recursive: true }); writeFileSync(store, JSON.stringify(seen)); } catch { /* ignore */ }

  if (prior >= 1) {
    const times = prior + 1;
    const out = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          `obol: this file has been read ${times}x this session (${path}). ` +
          `If its contents are already in context, re-reading re-bills the tokens — ` +
          `prefer what you already have unless the file changed.`,
      },
    };
    process.stdout.write(JSON.stringify(out));
  }
}

try { main(); } catch { /* never block a read */ }
process.exit(0);
