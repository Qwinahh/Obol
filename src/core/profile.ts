import type { Diagnosis, Finding } from "./types";
import { loadCatalog } from "./catalog";

/**
 * Step 4 — Profiles + per-technique toggles.
 *
 * A Profile is a *deterministic filter* over a diagnosis. It never changes the
 * math behind any single finding — it only decides which findings are allowed
 * to count as actionable "wins" for this user, given their appetite for risk:
 *
 *   - careful    : only high-confidence wins. Nothing speculative counts.
 *   - balanced   : high + medium confidence wins (the default).
 *   - aggressive : everything, down to low-confidence wins.
 *
 * On top of the preset, the user can switch individual techniques off entirely
 * (the advanced toggles). A switched-off technique never contributes savings,
 * regardless of confidence.
 *
 * Because the filter runs on the diagnosis and the whole report cascades from
 * it (apply -> recommend -> guard all read only `severity === "win"`), one
 * filter call re-shapes every downstream surface with zero drift and zero
 * tokens. Switching profiles is pure local math.
 */

export type ProfileId = "careful" | "balanced" | "aggressive";
export type Confidence = "high" | "med" | "low";

export interface Profile {
  id: ProfileId;
  /** Lowest confidence allowed to count as an actionable win. */
  minConfidence: Confidence;
  /** Technique ids the user has switched off entirely. */
  disabled: string[];
}

export interface ProfilePreset {
  id: ProfileId;
  name: string;
  minConfidence: Confidence;
  /** How Obol applies changes under this profile (display + intent). */
  applyStance: "green-only" | "green+amber";
  blurb: string;
}

/** The three shipped presets. Ordered careful -> balanced -> aggressive. */
export const PRESETS: Record<ProfileId, ProfilePreset> = {
  careful: {
    id: "careful",
    name: "Careful",
    minConfidence: "high",
    applyStance: "green-only",
    blurb: "Only high-confidence wins. Auto-applies safe, reversible changes only.",
  },
  balanced: {
    id: "balanced",
    name: "Balanced",
    minConfidence: "med",
    applyStance: "green+amber",
    blurb: "High and medium-confidence wins. The recommended default.",
  },
  aggressive: {
    id: "aggressive",
    name: "Aggressive",
    minConfidence: "low",
    applyStance: "green+amber",
    blurb: "Every detected win, including speculative low-confidence ones.",
  },
};

export const PROFILE_IDS: ProfileId[] = ["careful", "balanced", "aggressive"];

export function defaultProfile(): Profile {
  return { id: "balanced", minConfidence: PRESETS.balanced.minConfidence, disabled: [] };
}

const RANK: Record<Confidence, number> = { high: 3, med: 2, low: 1 };
export const confRank = (c: Confidence): number => RANK[c] ?? 0;

/** Normalise any partial/legacy profile object into a complete Profile. */
export function resolveProfile(p?: Partial<Profile> | ProfileId | null): Profile {
  if (!p) return defaultProfile();
  if (typeof p === "string") {
    const preset = PRESETS[p] ?? PRESETS.balanced;
    return { id: preset.id, minConfidence: preset.minConfidence, disabled: [] };
  }
  const id: ProfileId = (p.id && PRESETS[p.id]) ? p.id : "balanced";
  const preset = PRESETS[id];
  // The preset owns minConfidence; the only per-user override is the disabled set.
  const disabled = Array.isArray(p.disabled) ? p.disabled.filter((s) => typeof s === "string") : [];
  return { id, minConfidence: preset.minConfidence, disabled };
}

export function isEnabled(profile: Profile, techniqueId: string): boolean {
  return !profile.disabled.includes(techniqueId);
}

/**
 * The core transform. Returns a NEW diagnosis where any "win" the profile
 * excludes is demoted to an "info" note (kept visible, but worth $0 and no
 * longer driving apply/recommend/guard). Totals are recomputed from scratch.
 */
export function filterDiagnosis(d: Diagnosis, profile: Profile): Diagnosis {
  const min = confRank(profile.minConfidence);

  const findings: Finding[] = d.findings.map((f): Finding => {
    if (f.severity !== "win") return f;
    const enabled = isEnabled(profile, f.techniqueId);
    const confOk = confRank(f.confidence as Confidence) >= min;
    if (enabled && confOk) return f;
    // Demote: keep the row so the user sees what their choice silenced.
    return {
      ...f,
      severity: "info",
      estSaveUSD: 0,
      estSavePct: 0,
      autoApply: "n/a",
      mutedReason: enabled ? "below-confidence" : "disabled",
    };
  });

  const order = { win: 0, info: 1, ok: 2 } as const;
  findings.sort((a, b) =>
    order[a.severity] - order[b.severity] || b.estSaveUSD - a.estSaveUSD);

  const totalEstSaveUSD = findings.reduce((s, f) => s + f.estSaveUSD, 0);
  const totalCost = totalEstSaveUSD === 0 ? 0
    : (d.totalEstSavePct > 0 ? (d.totalEstSaveUSD / d.totalEstSavePct) * 100 : 0);
  const wins = findings.filter((f) => f.severity === "win");

  return {
    findings,
    totalEstSaveUSD,
    totalEstSavePct: totalCost > 0 ? (totalEstSaveUSD / totalCost) * 100 : 0,
    alreadyEfficient: wins.length === 0,
  };
}

export interface ProfileTechniqueView {
  id: string;
  name: string;
  tier: "A" | "B" | "C" | "D";
  enabled: boolean;
}

export interface ProfileView {
  id: ProfileId;
  name: string;
  minConfidence: Confidence;
  applyStance: "green-only" | "green+amber";
  blurb: string;
  techniques: ProfileTechniqueView[];
}

/** The UI-facing description of the active profile + every toggle's state. */
export function profileView(profile: Profile): ProfileView {
  const preset = PRESETS[profile.id];
  let techniques: ProfileTechniqueView[] = [];
  try {
    techniques = loadCatalog().techniques.map((t) => ({
      id: t.id, name: t.name, tier: t.tier, enabled: isEnabled(profile, t.id),
    }));
  } catch {
    techniques = [];
  }
  return {
    id: preset.id,
    name: preset.name,
    minConfidence: preset.minConfidence,
    applyStance: preset.applyStance,
    blurb: preset.blurb,
    techniques,
  };
}
