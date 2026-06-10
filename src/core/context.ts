import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Step 2b helper — name what's riding the cached prefix.
 * The bloated-prefix finding (B1) is only actionable if it tells you *what*
 * is in the prefix. The biggest movable chunk is MCP server tool definitions:
 * every configured server ships its tool schemas into every call. This reads
 * the local Claude Code config to list them. Local, zero-token, best-effort —
 * config shapes drift, so every lookup is defensive and failures are silent.
 */

export interface ContextConfig {
  mcpServers: string[];   // configured MCP server names, de-duped
  sources: string[];      // config files we actually read them from
}

/** Pull server names from any object shaped like { mcpServers: { name: {...} } }. */
function namesFrom(obj: any): string[] {
  const out: string[] = [];
  const servers = obj?.mcpServers;
  if (servers && typeof servers === "object") out.push(...Object.keys(servers));
  return out;
}

/** Candidate config files, in the order Claude Code layers them. */
function candidateFiles(cwd: string): string[] {
  const home = homedir();
  return [
    join(home, ".claude.json"),
    join(home, ".claude", "settings.json"),
    join(cwd, ".mcp.json"),
    join(cwd, ".claude", "settings.json"),
  ];
}

export function readContextConfig(cwd: string = process.cwd()): ContextConfig {
  const names = new Set<string>();
  const sources: string[] = [];

  for (const file of candidateFiles(cwd)) {
    if (!existsSync(file)) continue;
    let json: any;
    try { json = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }

    const before = names.size;
    for (const n of namesFrom(json)) names.add(n);

    // ~/.claude.json nests per-project config under "projects": { path: {...} }
    const projects = json?.projects;
    if (projects && typeof projects === "object") {
      for (const p of Object.values(projects)) {
        for (const n of namesFrom(p)) names.add(n);
      }
    }

    if (names.size > before) sources.push(file);
  }

  return { mcpServers: [...names].sort(), sources };
}
