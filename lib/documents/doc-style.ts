// =============================================================================
// lib/documents/doc-style.ts — the Blueprint paper style for client documents
// (K8 #15–16, spec §6.9, Figma 67:1396 / 67:1436 / 68:1396).
//
// Client documents and e-mails are LIGHT in both themes (spec §6.11), so the
// palette is Blueprint's light primitives written out (design-refs/r7-handoff/
// tokens.css): ink 900 / 700 / 600 on white, paper-300 hairlines, paper-400
// strong rules. Zero radius, hairlines, no fills except the inverse band, no
// status hues and no brass fill (brass draws lines only — and a client
// document needs none). Plex Sans for words, JetBrains Mono for numbers and
// labels, EB Garamond for the display title.
//
// Sizes are millimetres on an A4 page (the SVG user unit). Nothing a client
// reads is under 2.6 mm; the "prepared with" mark is the one 2.4 mm line.
// =============================================================================

import { esc } from "@/lib/drawings/sheet";

export const DOC = {
  INK: "#1A1D1F",
  INK_2: "#4A5054",
  INK_3: "#62676B",
  HAIR: "#D6D1C5",
  STRONG: "#A8A294",
  PAPER: "#FFFFFF",
  ON_INK: "#F5F2EA",
  // The rasteriser (resvg) reads TTF/OTF only and the app self-hosts woff2, so
  // on the server these resolve to the named fallbacks (Arial / Consolas /
  // Georgia) — never "system-ui", which resvg maps to whatever it finds first.
  SANS: "'IBM Plex Sans', Arial, Helvetica, sans-serif",
  MONO: "'JetBrains Mono', Consolas, 'Courier New', monospace",
  SERIF: "'EB Garamond', Georgia, serif",
} as const;

export const n1 = (n: number) => (Math.round(n * 10) / 10).toString();

export interface TextOpts {
  size?: number;
  fill?: string;
  font?: string;
  anchor?: "start" | "middle" | "end";
  weight?: number;
  /** Letter-spacing in em — label caps are 0.08em. */
  spacing?: number;
  /** Extra attributes, e.g. `data-grand-total="…"`. */
  attrs?: string;
}

/** One line of text. Escaped; never markup. */
export function text(x: number, y: number, s: string, o: TextOpts = {}): string {
  const style = `font-family:${o.font ?? DOC.SANS}${o.weight ? `;font-weight:${o.weight}` : ""}${o.spacing ? `;letter-spacing:${o.spacing}em` : ""}`;
  return `<text ${o.attrs ? `${o.attrs} ` : ""}x="${n1(x)}" y="${n1(y)}" font-size="${o.size ?? 2.8}" fill="${o.fill ?? DOC.INK}"${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""} style="${style}">${esc(s)}</text>`;
}

/** A small-caps label (mono, uppercase, tracked). */
export const label = (x: number, y: number, s: string, o: Omit<TextOpts, "font" | "spacing"> = {}) => text(x, y, s.toUpperCase(), { size: 2.6, fill: DOC.INK_3, ...o, font: DOC.MONO, spacing: 0.08 });

export const hline = (x1: number, x2: number, y: number, stroke: string = DOC.HAIR, width = 0.25) => `<line x1="${n1(x1)}" y1="${n1(y)}" x2="${n1(x2)}" y2="${n1(y)}" stroke="${stroke}" stroke-width="${width}"/>`;

/** Greedy word wrap to a character budget. */
export function wrapWords(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** "4 October 2026" from an ISO date (the UTC day — documents are reproducible). */
export function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The inverse band (spec §2: every refusal or status statement is the inverse
 * block) — ink fill, paper text. Used for the draft statement on paper.
 */
export function inverseBand(x: number, y: number, w: number, lines: string[], attrs = ""): { svg: string; h: number } {
  const lh = 3.6;
  const h = 4.4 + lines.length * lh;
  let s = `<rect ${attrs} x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="${DOC.INK}"/>`;
  lines.forEach((l, i) => {
    s += text(x + 3.5, y + 5 + i * lh, l, { size: 2.6, fill: DOC.ON_INK, font: DOC.MONO, spacing: 0.04 });
  });
  return { svg: s, h };
}

/** A page placeholder replaced once every page exists ("page 4 of 9"). */
export const PAGE_COUNT_TOKEN = "@@PAGES@@";

/** A page of the given size in millimetres, on white. */
export const docPage = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" fill="${DOC.PAPER}"/>${body}</svg>`;
