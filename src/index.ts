// Public surface of the Obol core. Each step adds to this; surfaces import from here.
export * from "./core/types";
export { loadCatalog, autoApplyBreakdown } from "./core/catalog";
export { ratesFor, costOf } from "./core/pricing";
export { readUsage } from "./core/usage";
export { diagnose } from "./core/diagnose";
export { proof, measureCacheSavings } from "./core/proof";
export type { Proof, CacheReceipt } from "./core/proof";
export { planApply, applyGreen, renderPlanMarkdown } from "./core/apply";
export type { ApplyPlan, ApplyAction, ApplyKind, AppliedResult } from "./core/apply";
export { demoUsage } from "./core/demo";
export { planGuard, runGuard, anthropicCaller, CANARIES, shortModel } from "./core/guard";
export type {
  GuardPlan, GuardProbe, GuardRisk, GuardVerdict, CanaryResult, ModelCaller, Canary,
} from "./core/guard";
export { fingerprint } from "./core/fingerprint";
export type { Fingerprint } from "./core/fingerprint";
export { recommend } from "./core/recommend";
export type { NextStep } from "./core/recommend";
export {
  resolveProfile, filterDiagnosis, profileView, defaultProfile,
  isEnabled, confRank, PRESETS, PROFILE_IDS,
} from "./core/profile";
export type {
  Profile, ProfileId, ProfilePreset, ProfileView, ProfileTechniqueView, Confidence,
} from "./core/profile";
export {
  loadHistory, recordRun, summarize, demoHistory, historyPath,
} from "./core/history";
export type {
  HistorySummary, HistoryEntry, HistoryFile, HistoryPoint, HistoryKind, RecordInput,
} from "./core/history";
export { buildReport } from "./core/report";
export { shareCard } from "./core/sharecard";
export {
  eventsFromRow, tail, activeSessionFile, demoActivity, modelSaving,
} from "./core/activity";
export type { ActivityEvent, ActivityKind, TailResult } from "./core/activity";
export {
  loadIdentity, setName, validateName, identityPath, buildSubmission,
  signSubmission, verifySignature, recompute, plausible, acceptSubmission,
  canonical, CAPS, SUB_SCHEMA,
} from "./core/leaderboard";
export type {
  Submission, SignedSubmission, SubModel, Identity, PlausibleResult, AcceptResult,
} from "./core/leaderboard";
export type { ShareCardOpts } from "./core/sharecard";
export type { ObolReport } from "./core/report";
