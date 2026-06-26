import type { ObolReport } from "./report";

/**
 * Step 6 — the share card.
 *
 * A single, self-contained SVG that turns a report into something a developer
 * wants to post: "Obol measured $X my caching already saved." It is pure,
 * deterministic and zero-token — built only from numbers already in the report,
 * so the card can never claim a figure the tool didn't compute. No backend, no
 * network: the SVG string is the whole artifact; surfaces just save it (and may
 * rasterise it to PNG client-side).
 */

const esc = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const usd = (n: number): string => {
  const v = Math.abs(n);
  const s = v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "$") + s;
};

function sparkPoints(vals: number[], x0: number, y0: number, w: number, h: number): string {
  const n = vals.length;
  if (n < 2) return "";
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = (max - min) || 1;
  const x = (i: number) => x0 + (i / (n - 1)) * w;
  const y = (v: number) => y0 + h - ((v - min) / span) * h;
  return vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

export interface ShareCardOpts {
  /** Override the headline figure source. Defaults to the measured receipt. */
  handle?: string; // e.g. a repo/user handle for the footer
}

/** Build the share-card SVG (1200×630, OG ratio). Deterministic. */
export function shareCard(r: ObolReport, opts: ShareCardOpts = {}): string {
  const W = 1200, H = 630;
  const measured = r.proof?.cache?.savedUSD ?? 0;
  const hist = r.history;
  const allTime = hist?.measuredSavedUSD ?? measured;
  const streak = hist?.currentStreak ?? 0;
  const fixes = hist?.appliedFixes ?? 0;
  const runs = hist?.runs ?? 0;
  const profName = r.profile?.name ?? "Balanced";
  const handle = esc(opts.handle || "deterministic · free · zero-token");

  const trend = (hist?.trend || []).map((p) => p.savedUSD);
  const pts = sparkPoints(trend, 96, 470, W - 192, 96);
  const sparkArea = pts ? `${96},566 ${pts} ${W - 96},566` : "";

  // secondary stat chips
  const chips: Array<[string, string]> = [];
  chips.push(["all-time saved", usd(allTime)]);
  if (fixes > 0) chips.push(["fixes locked in", String(fixes)]);
  if (streak > 1) chips.push(["streak", `${streak} days`]);
  if (runs > 0) chips.push(["runs", String(runs)]);
  chips.push(["profile", profName]);

  const chipW = 196, chipGap = 18, chipY = 372;
  const chipSvg = chips.slice(0, 5).map((c, i) => {
    const x = 96 + i * (chipW + chipGap);
    return `
    <g transform="translate(${x},${chipY})">
      <rect width="${chipW}" height="64" rx="12" fill="#13181a" stroke="#ffffff14"/>
      <text x="18" y="27" font-family="${FNUM}" font-size="22" font-weight="600" fill="#e9edec">${esc(c[1])}</text>
      <text x="18" y="49" font-family="${FUI}" font-size="14" fill="#8a938f" letter-spacing=".02em">${esc(c[0])}</text>
    </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Obol savings card">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0b0c"/>
      <stop offset="1" stop-color="#0c1110"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#43c595"/>
      <stop offset="1" stop-color="#39b487"/>
    </linearGradient>
    <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#43c595" stop-opacity=".22"/>
      <stop offset="1" stop-color="#43c595" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="28" fill="none" stroke="#ffffff10" stroke-width="2"/>
  <circle cx="${W - 130}" cy="150" r="220" fill="#43c595" opacity="0.05"/>

  <!-- brand -->
  <g transform="translate(96,84)">
    <circle cx="14" cy="6" r="14" fill="none" stroke="url(#acc)" stroke-width="3"/>
    <circle cx="14" cy="6" r="4.5" fill="#43c595"/>
    <text x="44" y="15" font-family="${FUI}" font-size="30" font-weight="600" fill="#e9edec" letter-spacing="-.01em">obol</text>
    <text x="118" y="15" font-family="${FUI}" font-size="18" fill="#6c7572">token report</text>
  </g>

  <!-- headline -->
  <text x="96" y="218" font-family="${FUI}" font-size="26" fill="#9aa4a1" letter-spacing=".04em">MEASURED SAVED BY CACHING</text>
  <text x="92" y="320" font-family="${FNUM}" font-size="116" font-weight="700" fill="url(#acc)" letter-spacing="-.02em">${esc(usd(measured))}</text>
  <text x="${W - 96}" y="218" text-anchor="end" font-family="${FUI}" font-size="20" fill="#6c7572">proven, not estimated</text>

  ${chipSvg}

  <!-- trend -->
  ${sparkArea ? `<polygon points="${sparkArea}" fill="url(#sparkfill)"/>` : ""}
  ${pts ? `<polyline points="${pts}" fill="none" stroke="#43c595" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` : ""}

  <!-- footer -->
  <line x1="96" y1="590" x2="${W - 96}" y2="590" stroke="#ffffff0d" stroke-width="1.5"/>
  <text x="96" y="${H - 26}" font-family="${FUI}" font-size="17" fill="#6c7572">${handle}</text>
  <text x="${W - 96}" y="${H - 26}" text-anchor="end" font-family="${FUI}" font-size="17" fill="#6c7572">no LLM in the loop · runs on your machine</text>
</svg>`;
}

const FUI = "'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif";
const FNUM = "'Cascadia Code','JetBrains Mono','SF Mono',ui-monospace,monospace";
