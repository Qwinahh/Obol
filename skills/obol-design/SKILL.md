---
name: obol-design
description: The Obol visual design system. Use whenever building, restyling, or reviewing any Obol surface — the VS Code panel, share card, CLI banner, README art, or marketing. Defines the coin-mint identity: antique-gold money, verdigris live accent, warm-ink canvas, the custom coin mark + wordmark, an editorial serif + mono "system" voice (never generic sans), the odometer/tape motif, motion, and microcopy voice. Read this before changing any pixel of Obol.
---

# Obol Design System — "The Mint"

Obol is named after an ancient coin. The entire identity is a **mint**: a quiet,
precise place where saved money is struck and tallied. Every decision serves one
feeling — *watching a meter run in your favour.* Premium comes from restraint,
proportion, and spacing, not decoration.

## 0. The one-line test
If a screen could belong to any generic AI dashboard, it is wrong. Obol must read
as: warm ink, struck gold money, a living tape, an editorial serif voice. No
purple/blue gradients, no default Inter/Helvetica body, no centered rounded-card grid.

## 1. Palette (the only colours)
Canvas + surfaces (warm, achromatic-warm, NOT grey-blue):
- `--ink:#0b0a08`  page canvas (warm near-black)
- `--ink-2:#100e0b` raised ground
- `--panel:#15120d` card surface · `--panel-2:#1c1810` raised card · `--inset:#0d0b08`
- `--hair:#2a2419` border · `--hair-2:#1e190f` faint border · `--hair-gold:rgba(217,178,91,.22)`

Ink/text:
- `--paper:#f4efe4` primary (warm white) · `--body:#b7ad99` secondary · `--mute:#867c69` labels · `--faint:#5c5443` micro

Gold = MONEY + brand. Reserve for currency, the wordmark, the primary action.
- `--gold:#e6c574` · `--gold-2:#d9b25b` · `--gold-deep:#a87c2f` · `--gold-soft:rgba(217,178,91,.10)`

Verdigris = LIVE / POSITIVE / SAVED-NOW (patina of an old coin). The only other accent.
- `--verd:#4fb89a` · `--verd-deep:#2f9e84` · `--verd-soft:rgba(79,184,154,.12)`

Rules: two accents only. Gold never on plain UI chrome; verdigris never on money totals.
Depth is colorimetric (surface steps + 1px hairlines). No drop shadows except a
single soft gold glow under the odometer and the primary CTA.

## 2. Type — editorial + mechanical, never generic
Three registers, all embedded offline (assets/fonts.css). NEVER fall back to a
default system sans for body — that is the "generic AI" tell the user rejects.
- **Serif — `'Obol Serif'` (Lora)**: money figures, headings, section titles, and
  body/description copy. This editorial serif is the premium voice. Tracking near 0;
  on big money use letter-spacing -0.01em.
- **Mono — `'Obol Mono'` (Noto Sans Mono)**: ALL labels, eyebrows, the tape/ticker,
  metrics, ids, tags. Uppercase eyebrows at `letter-spacing:.2em–.24em`, 10–11px,
  color `--mute`. This is the "system readout" voice.
- **Sans — `'Obol Sans'` (Nimbus/Helvetica-grotesque)**: ONLY buttons and the rare
  dense UI control. Used sparingly. Not for body.

Scale (panel, ~440px): odometer money 76–92px serif 600, -0.02em, line .88; section
heading 18–20px serif; body 12.5–13px serif 1.55; eyebrow 10.5px mono .22em upper;
tape 12px mono; micro/footer 10px mono .14em upper.

Never use heavy weights >700. Tight headings (line .88–1.1), relaxed body (1.5–1.6).

## 3. Logo
- **Mark** (assets/mark.svg): a minimal monoline gold coin — two concentric thin
  rings + one short top arc as a glint of struck light. No center dot, no fill.
  Sizes: 22–26px in panel header, 40px empty state. Always gold gradient on ink.
- **Wordmark**: "Obol" set in `'Obol Serif'` 600, letter-spacing .01em, `--paper`.
  Lockup: mark + 9px gap + wordmark, optically centered on the wordmark cap height.
- Do NOT use the unicode ◎, a rounded-square, or a ring-and-dot. Minimal, professional.

## 4. Signature components
- **Odometer**: the hero. Gold serif total that mechanically rolls UP when a saving
  lands (cubic ease, ~700ms). `$` in `--gold-2` at ~45% the digit size.
- **The Tape**: a live mono ticker. Each row = a verb (`--paper`, or `--verd` for a
  model-tiering event) + dotted leader + the money saved on that line (gold `+$0.0x`
  or a faint `—`). New rows slide in from the bottom; keep ~5 visible. A gold→verdigris
  hairline runs down the left edge. This fusion of action + money is the core delight.
- **Coin-edge divider**: `repeating-linear-gradient(90deg,var(--hair-gold) 0 1px,transparent 1px 7px)` — reeded coin edge, the only ornament.
- **Tally**: three hairline cells (all-time / streak / runs), serif numerals, mono caps labels.
- **Profile dial**: pill-radius segmented control, active tab gets a gold-tinted inset.
- **Primary action = "Strike"**: gold pill, ink text, soft gold glow. Everything else
  is a hairline ghost pill. One filled action per screen.

## 5. Motion
150ms ease-out (`cubic-bezier(.22,1,.36,1)`) on hover/state; instant snap on press.
Odometer roll ~700ms. Live dot: a 1.6s expanding-ring pulse. Respect
`prefers-reduced-motion` — drop pulses and rolls, keep final values. Motion must feel
mechanical and earned, never decorative.

## 6. Voice / microcopy (kill generic AI phrasing)
Mint vocabulary, sharp and concrete. Examples:
- hero eyebrow: "CACHING HAS MINTED YOU"  (not "you saved")
- tally: "ALL-TIME", "STREAK", "RUNS"
- profile: "how hard to chase" · "counts wins at MED confidence or higher"
- CTA: "Strike 1 safe fix · reversible"  ·  secondary "Plan"
- footer: "deterministic · free · zero-token / no llm in the loop · minted on your machine"
Never write filler like "Here's your dashboard" or "Analyzing your data…". Lead with
the number and the verb. Money is always shown to the cent.

## 7. Do / Don't
Do: warm ink, reserve gold for money, serif for reading, mono for system labels,
hairlines for structure, one filled action, generous vertical rhythm (20–28px between groups).
Don't: generic sans body, blue/purple, drop-shadow cards, centered card grids,
two filled buttons, gold on non-money chrome, radii between 12px and the pill.

## 8. Apply checklist (before shipping any Obol screen)
1. Body text is `'Obol Serif'`, labels are `'Obol Mono'` uppercase — no system sans.
2. Money is gold serif; live/saved is verdigris; nothing else is coloured.
3. The custom coin mark + serif wordmark are present and aligned.
4. Cards are flat hairline; depth is surface colour only.
5. Microcopy uses the mint voice; numbers to the cent.
6. One gold "Strike" action; reduced-motion respected.
