import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, Technique } from "./types";

/**
 * Loads and validates the technique catalog — the deterministic rules engine
 * that drives every diagnosis. No model call here, ever: this is the property
 * that makes Obol free, instant, and repeatable.
 */
export function loadCatalog(): Catalog {
  // catalog.json lives at <pkg>/data/catalog.json; dist/ is one level under <pkg>.
  const path = join(__dirname, "..", "..", "data", "catalog.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Catalog;
  validate(raw);
  return raw;
}

function validate(c: Catalog): void {
  if (!c.version) throw new Error("catalog: missing version");
  if (!Array.isArray(c.techniques) || c.techniques.length === 0) {
    throw new Error("catalog: no techniques loaded");
  }
  const ids = new Set<string>();
  for (const t of c.techniques) {
    requireFields(t);
    if (ids.has(t.id)) throw new Error(`catalog: duplicate technique id "${t.id}"`);
    ids.add(t.id);
  }
}

function requireFields(t: Technique): void {
  const missing = (["id", "name", "tier", "wasteType", "savesSide", "autoApply", "summary"] as const)
    .filter((k) => t[k] === undefined || t[k] === "");
  if (missing.length) {
    throw new Error(`catalog: technique "${t.id ?? "?"}" missing fields: ${missing.join(", ")}`);
  }
}

/** Count of green (auto-applyable) vs amber (recommend-only) techniques. */
export function autoApplyBreakdown(c: Catalog): { green: number; amber: number } {
  return {
    green: c.techniques.filter((t) => t.autoApply === "green").length,
    amber: c.techniques.filter((t) => t.autoApply === "amber").length,
  };
}
