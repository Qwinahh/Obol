import type { UsageSummary, Diagnosis } from "./types";
import { diagnose } from "./diagnose";
import { proof, type Proof } from "./proof";
import { planApply, type ApplyPlan } from "./apply";
import { recommend, type NextStep } from "./recommend";
import { planGuard, type GuardPlan } from "./guard";
import { fingerprint, type Fingerprint } from "./fingerprint";
import {
  resolveProfile, filterDiagnosis, profileView,
  type Profile, type ProfileId, type ProfileView,
} from "./profile";
import type { HistorySummary } from "./history";

/**
 * One assembled report — every deterministic surface in a single object.
 * Both the CLI (`--json`) and the VS Code extension build from this, so the
 * numbers are computed in exactly one place and can never drift between
 * surfaces. Pure, zero-token: the Quality Guard is described here (the free
 * plan) but its paid live check is never invoked from this function.
 *
 * The optional `profile` re-shapes the whole report deterministically: the raw
 * diagnosis is filtered once, then apply -> recommend -> guard all cascade from
 * the filtered findings. Switching profiles is local math, no re-read, no
 * tokens.
 */
export interface ObolReport {
  version: string;
  generatedAt: string;
  found: boolean;
  source?: string;
  usage: UsageSummary;
  fingerprint: Fingerprint;
  proof: Proof;
  diagnosis: Diagnosis;
  apply: ApplyPlan;
  nextSteps: NextStep[];
  guard: GuardPlan;
  /** Active profile + the state of every per-technique toggle. */
  profile: ProfileView;
  /** Local, on-disk savings history (all-time saved, streaks, trend). Optional:
   *  surfaces that don't keep a ledger simply omit it. */
  history?: HistorySummary;
}

export function buildReport(
  u: UsageSummary,
  version = "0.0.0",
  profile?: Partial<Profile> | ProfileId | null,
  history?: HistorySummary,
): ObolReport {
  const p = resolveProfile(profile);
  const raw = diagnose(u);
  const d = filterDiagnosis(raw, p);
  const apply = planApply(d, u);
  return {
    version,
    generatedAt: new Date().toISOString(),
    found: u.found,
    source: u.source,
    usage: u,
    fingerprint: fingerprint(u),
    proof: proof(u),
    diagnosis: d,
    apply,
    nextSteps: recommend(d, apply),
    guard: planGuard(apply, u),
    profile: profileView(p),
    history,
  };
}
