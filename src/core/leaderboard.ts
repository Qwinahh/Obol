import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  generateKeyPairSync, sign as edSign, verify as edVerify, randomBytes,
  createPublicKey, createPrivateKey,
} from "node:crypto";
import { ratesFor } from "./pricing";
import type { ObolReport } from "./report";

/**
 * Step 7 — the opt-in global leaderboard (with real anti-cheat).
 *
 * Everything here is OFF by default: nothing is ever sent anywhere unless the
 * user configures an endpoint and explicitly submits. The submission carries
 * only public aggregates — never prompts, file paths, or raw logs.
 *
 * Anti-cheat rests on three independent walls, so beating one isn't enough:
 *
 *   1. Server recompute. The client sends per-model cached-token counts and a
 *      claimed dollar figure. The server re-derives the dollars from those
 *      tokens with the SAME pricing table (recompute()). Inflating the dollars
 *      without inflating tokens is rejected outright — the math has to close.
 *
 *   2. Plausibility caps. Token counts and dollars must sit under hard ceilings
 *      and be internally consistent (plausible()). Absurd numbers are dropped.
 *
 *   3. Identity (TOFU + Ed25519). Each machine holds an Ed25519 private key that
 *      never leaves it. The first submission for a name registers its public key
 *      (trust-on-first-use); later submissions must verify against that key, so
 *      nobody can submit under someone else's name.
 *
 * A "verified" tier (server-side) can additionally require a live-measured
 * receipt — the one paid path — for users who want a stronger badge. The free
 * path stays free, local, and deterministic.
 */

export const SUB_SCHEMA = 1;

/** Hard plausibility ceilings — the single source the server imports too. */
export const CAPS = {
  maxSavedUSD: 5_000_000,        // all-time measured cache savings ceiling
  maxCachedTokens: 2_000_000_000_000, // 2T tokens
  maxPerModelTokens: 1_000_000_000_000,
  maxModels: 24,
  recomputeTolUSD: 0.5,         // allowed |claim - recompute| before rejecting
} as const;

export interface SubModel { model: string; cacheRead: number; cacheWrite: number; }

export interface Submission {
  v: number;
  name: string;
  displayName?: string;
  period: "all";
  measuredSavedUSD: number;   // claimed; the server overwrites with its recompute
  cachedTokens: number;
  models: SubModel[];
  clientVersion: string;
  generatedAt: string;
  nonce: string;
}

export interface SignedSubmission {
  submission: Submission;
  publicKey: string;  // SPKI PEM
  signature: string;  // base64
}

export interface Identity {
  name?: string;
  publicKey: string;  // SPKI PEM
  privateKey: string; // PKCS8 PEM — NEVER transmitted, NEVER committed
}

export function identityPath(): string {
  return join(homedir(), ".obol", "identity.json");
}

/** Load the local identity, generating an Ed25519 keypair on first use. */
export function loadIdentity(file = identityPath()): Identity {
  try {
    if (existsSync(file)) {
      const id = JSON.parse(readFileSync(file, "utf8")) as Identity;
      if (id && id.publicKey && id.privateKey) return id;
    }
  } catch { /* fall through to regenerate */ }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id: Identity = {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  persistIdentity(id, file);
  return id;
}

function persistIdentity(id: Identity, file = identityPath()): void {
  try {
    mkdirSync(join(homedir(), ".obol"), { recursive: true });
    writeFileSync(file, JSON.stringify(id, null, 2) + "\n", "utf8");
  } catch { /* best-effort; submission can still proceed in-memory */ }
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/;
export function validateName(name: string): { ok: boolean; reason?: string } {
  const n = String(name || "").toLowerCase();
  if (!NAME_RE.test(n)) return { ok: false, reason: "name must be 2–24 chars: a–z, 0–9, _ or -" };
  return { ok: true };
}

/** Claim a leaderboard handle (stored locally with the keypair). */
export function setName(name: string, file = identityPath()): Identity {
  const v = validateName(name);
  if (!v.ok) throw new Error(v.reason);
  const id = loadIdentity(file);
  id.name = String(name).toLowerCase();
  persistIdentity(id, file);
  return id;
}

/** Stable, key-sorted JSON so client and server hash exactly the same bytes. */
export function canonical(obj: unknown): string {
  return JSON.stringify(sortDeep(obj));
}
function sortDeep(v: any): any {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

/** Build a submission from a report — public aggregates only. */
export function buildSubmission(
  r: ObolReport, name: string, displayName?: string,
): Submission {
  const models: SubModel[] = (r.usage.byModel || []).map((m) => ({
    model: m.model,
    cacheRead: Math.max(0, Math.round(m.cacheRead || 0)),
    cacheWrite: Math.max(0, Math.round(m.cacheWrite || 0)),
  }));
  const cachedTokens = models.reduce((s, m) => s + m.cacheRead + m.cacheWrite, 0);
  return {
    v: SUB_SCHEMA,
    name: String(name).toLowerCase(),
    displayName: displayName || undefined,
    period: "all",
    measuredSavedUSD: round2(r.proof?.cache?.savedUSD ?? 0),
    cachedTokens,
    models,
    clientVersion: r.version,
    generatedAt: new Date().toISOString(),
    nonce: randomBytes(12).toString("hex"),
  };
}

export function signSubmission(sub: Submission, id: Identity): SignedSubmission {
  const key = createPrivateKey(id.privateKey);
  const sig = edSign(null, Buffer.from(canonical(sub), "utf8"), key);
  return { submission: sub, publicKey: id.publicKey, signature: sig.toString("base64") };
}

/** Verify the signature is valid for the *attached* public key. (TOFU name↔key
 *  binding is enforced separately by the server.) */
export function verifySignature(signed: SignedSubmission): boolean {
  try {
    const key = createPublicKey(signed.publicKey);
    return edVerify(
      null,
      Buffer.from(canonical(signed.submission), "utf8"),
      key,
      Buffer.from(signed.signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** Server-side recompute: derive the dollar figure from the submitted tokens
 *  using the shared pricing table. This is the wall that makes a forged dollar
 *  number impossible without forging tokens. Mirrors proof.measureCacheSavings. */
export function recompute(sub: Submission): { savedUSD: number; cachedTokens: number } {
  let hypothetical = 0, actual = 0, cachedTokens = 0;
  for (const m of sub.models || []) {
    const r = ratesFor(m.model);
    const cr = Math.max(0, m.cacheRead || 0), cw = Math.max(0, m.cacheWrite || 0);
    cachedTokens += cr + cw;
    hypothetical += ((cr + cw) * r.input) / 1_000_000;
    actual += (cr * r.cacheRead + cw * r.cacheWrite) / 1_000_000;
  }
  return { savedUSD: round2(hypothetical - actual), cachedTokens };
}

export interface PlausibleResult { ok: boolean; reason?: string; savedUSD: number; }

/** Apply the hard caps + internal-consistency check. Returns the trusted figure. */
export function plausible(sub: Submission): PlausibleResult {
  const re = recompute(sub);
  if (!sub.models || !sub.models.length) return { ok: false, reason: "no model data", savedUSD: 0 };
  if (sub.models.length > CAPS.maxModels) return { ok: false, reason: "too many models", savedUSD: 0 };
  for (const m of sub.models) {
    if (m.cacheRead < 0 || m.cacheWrite < 0) return { ok: false, reason: "negative tokens", savedUSD: 0 };
    if (m.cacheRead > CAPS.maxPerModelTokens || m.cacheWrite > CAPS.maxPerModelTokens)
      return { ok: false, reason: "per-model tokens over cap", savedUSD: 0 };
  }
  if (re.cachedTokens > CAPS.maxCachedTokens) return { ok: false, reason: "cached tokens over cap", savedUSD: 0 };
  if (!isFinite(re.savedUSD) || re.savedUSD < 0) return { ok: false, reason: "non-positive savings", savedUSD: 0 };
  if (re.savedUSD > CAPS.maxSavedUSD) return { ok: false, reason: "savings over cap", savedUSD: 0 };
  if (Math.abs(re.savedUSD - (sub.measuredSavedUSD || 0)) > CAPS.recomputeTolUSD)
    return { ok: false, reason: "claimed savings don't match recompute", savedUSD: re.savedUSD };
  return { ok: true, savedUSD: re.savedUSD };
}

function round2(n: number): number { return Math.round(((n || 0) + Number.EPSILON) * 100) / 100; }

/** Full server-side acceptance check, combining all three walls. The caller
 *  supplies the public key currently registered for this name (TOFU), or null
 *  if the name is new (first submission registers signed.publicKey). */
export interface AcceptResult { ok: boolean; reason?: string; savedUSD: number; registerKey?: string; }
export function acceptSubmission(signed: SignedSubmission, registeredKey: string | null): AcceptResult {
  const nameOk = validateName(signed.submission.name);
  if (!nameOk.ok) return { ok: false, reason: nameOk.reason, savedUSD: 0 };
  if (!verifySignature(signed)) return { ok: false, reason: "bad signature", savedUSD: 0 };
  if (registeredKey && normalizePem(registeredKey) !== normalizePem(signed.publicKey))
    return { ok: false, reason: "name is held by another key", savedUSD: 0 };
  const pl = plausible(signed.submission);
  if (!pl.ok) return { ok: false, reason: pl.reason, savedUSD: pl.savedUSD };
  return { ok: true, savedUSD: pl.savedUSD, registerKey: registeredKey ? undefined : signed.publicKey };
}

const normalizePem = (p: string): string => String(p).replace(/\s+/g, "");
