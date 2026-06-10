/**
 * Step 6 — the satisfying visual layer.
 * Dependency-free terminal primitives: ANSI colour, ANSI-aware width, boxes,
 * bars, a stacked composition bar, and a sparkline. No npm packages — keeps the
 * zero-install promise and renders cleanly in the VS Code terminal.
 */

const ESC = "\x1b[";
const code = (n: string) => (s: string) => `${ESC}${n}m${s}${ESC}0m`;

export const c = {
  dim: code("2"), bold: code("1"), italic: code("3"),
  green: code("32"), amber: code("33"), cyan: code("36"),
  red: code("31"), blue: code("34"), magenta: code("35"), gray: code("90"),
  // backgrounds for the stacked bar
  bgCyan: code("46"), bgGreen: code("42"), bgYellow: code("43"), bgMagenta: code("45"),
};

/** Visible length, ignoring ANSI escape sequences. */
export const visLen = (s: string): number =>
  s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Pad a (possibly coloured) string to a visible width. */
export const padEndV = (s: string, n: number): string =>
  s + " ".repeat(Math.max(0, n - visLen(s)));
export const padStartV = (s: string, n: number): string =>
  " ".repeat(Math.max(0, n - visLen(s))) + s;

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
export const usd = (n: number) => "$" + n.toFixed(2);
export const tok = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
  : n >= 1_000 ? (n / 1_000).toFixed(0) + "k" : `${n}`;

const W = 60; // content width

/** A rounded box around a single title line — the header chip. */
export function chip(text: string): string[] {
  const inner = W - 2;
  const top = c.dim("╭" + "─".repeat(inner) + "╮");
  const mid = c.dim("│") + " " + padEndV(text, inner - 1) + c.dim("│");
  const bot = c.dim("╰" + "─".repeat(inner) + "╯");
  return [top, mid, bot];
}

/** A simple labelled progress bar. value/max → filled portion. */
export function bar(value: number, max: number, width = 24, color = c.green): string {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(frac * width);
  return color("█".repeat(filled)) + c.gray("░".repeat(width - filled));
}

/**
 * A stacked single-line bar. Segments are [label, value, colorFn]. Colours are
 * applied as foreground blocks so it reads even without truecolor bg support.
 */
export function stackedBar(
  segments: { label: string; value: number; color: (s: string) => string }[],
  width = W - 2,
): { line: string; legend: string } {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let used = 0;
  let line = "";
  segments.forEach((seg, i) => {
    let w = Math.round((seg.value / total) * width);
    if (i === segments.length - 1) w = width - used; // absorb rounding
    used += w;
    line += seg.color("█".repeat(Math.max(0, w)));
  });
  const legend = segments
    .map((s) => s.color("█") + " " + c.dim(`${s.label} ${Math.round((s.value / total) * 100)}%`))
    .join("   ");
  return { line, legend };
}

/** A unicode sparkline from a series of values. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const ticks = "▁▂▃▄▅▆▇█";
  const max = Math.max(...values, 0);
  if (max <= 0) return c.gray("▁".repeat(values.length));
  return values
    .map((v) => {
      const idx = Math.max(0, Math.min(ticks.length - 1, Math.round((v / max) * (ticks.length - 1))));
      return ticks[idx];
    })
    .join("");
}

/** Indent every line of a block by two spaces. */
export const indent = (s: string) => s.split("\n").map((l) => "  " + l).join("\n");

export const RULE = c.dim("─".repeat(W));
export const WIDTH = W;
