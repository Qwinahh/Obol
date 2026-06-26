# Obol leaderboard — reference server

Tiny, dependency-free reference implementation of the opt-in global leaderboard.
It exists to demonstrate the anti-cheat model end to end. Deploy your own; Obol
ships nothing hosted.

## Why you can trust the numbers

The trust rules live in the shared Obol core (`acceptSubmission`), so the client
and server agree on exactly one definition of "valid". Four independent walls:

1. **Signature (Ed25519).** Every submission is signed by a private key that
   never leaves the user's machine.
2. **Name ↔ key (trust-on-first-use).** The first submission for a name registers
   its public key. Later submissions under that name must verify against it, so
   nobody can submit as someone else.
3. **Server recompute.** The client sends per-model cached-token counts and a
   claimed dollar figure. The server **re-derives** the dollars from those tokens
   with the same pricing table and stores *its* number, not the claim. Inflating
   dollars without inflating tokens is impossible.
4. **Plausibility caps.** Token counts and dollars must sit under hard ceilings
   and be internally consistent.

A submission carries only public aggregates — per-model cached-token counts and
the measured cache figure. Never prompts, file paths, or raw logs.

## Run

```bash
# from the repo root, after `npm run build`
node server/index.js              # listens on :8787
PORT=9000 node server/index.js    # custom port
```

Point clients at it:

```bash
export OBOL_LEADERBOARD_URL=http://localhost:8787
obol --submit        # claim a name first: obol --name <handle>
obol --leaderboard
```

## Endpoints

- `POST /submit` — body is a `SignedSubmission`; returns `{ ok, rank, savedUSD }`.
- `GET /leaderboard?limit=50` — `{ entries: [{ rank, name, savedUSD, verified, ... }] }`.
- `GET /health` — `{ ok: true }`.

## Storage

A plain JSON file at `./data/leaderboard.json` (git-ignored). No database, no
secrets, no env keys. For production you'd swap `load()/save()` for a real store
and add rate-limiting; the verification logic stays in the core untouched.

## Verified tier

`verified` is a server-side flag for users who additionally submit a
live-measured receipt (the one paid path in Obol). The free path stays free,
local, and deterministic — it simply isn't badged.
