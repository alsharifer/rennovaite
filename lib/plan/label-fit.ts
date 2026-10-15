// =============================================================================
// lib/plan/label-fit.ts — room labels that stay inside their outline (rule 12).
// PURE.
//
// The editor used to choose a label layout by the room's width alone, so a
// long name ("Powder Room / WD") or a dimension line ran past a small outline
// (Maid Room, Bath, Stairs on Jumeirah Parks). Here every line is measured
// (an estimate from character widths — the canvas has no DOM text metrics at
// render time) and the label is reduced step by step until it fits: the long
// size line → area only, smaller type, an abbreviated name, no Arabic line, the
// area alone, nothing. The full name stays in a tooltip.
// =============================================================================

export type LabelLineKind = "en" | "ar" | "meta";

export interface LabelLine {
  kind: LabelLineKind;
  text: string;
  fontPx: number;
}

export interface LabelFit {
  lines: LabelLine[];
  /** True when the name shown is not the full name (abbreviated or dropped). */
  shortened: boolean;
}

const PAD_X = 6;
const PAD_Y = 4;
const LINE_GAP = 1.35;

/** Estimated advance of a string at `px` (IBM Plex Sans / Plex Sans Arabic / JetBrains Mono). */
export function textWidthPx(text: string, px: number, kind: LabelLineKind): number {
  if (kind === "meta") return text.length * 0.6 * px; // mono
  let em = 0;
  for (const ch of text) {
    if (/[؀-ۿ]/.test(ch)) em += 0.5;
    else if (ch === " ") em += 0.27;
    else if (/[A-Z0-9]/.test(ch)) em += 0.64;
    else if (/[a-z]/.test(ch)) em += 0.53;
    else em += 0.32;
  }
  return em * px;
}

const ABBR: [RegExp, string][] = [
  [/\bBedroom\b/g, "Bed"],
  [/\bBathroom\b/g, "Bath"],
  [/\bRoom\b/g, "Rm"],
  [/\bMaster\b/g, "Mstr"],
  [/\bEntrance\b/g, "Entr."],
  [/\bKitchen\b/g, "Kit."],
  [/\bLiving\b/g, "Liv."],
  [/\bFamily\b/g, "Fam."],
  [/\bDressing\b/g, "Dress"],
  [/\bPowder\b/g, "Pwdr"],
  [/\bStorage\b/g, "Store"],
  [/\bBalcony\b/g, "Balc."],
  [/\bTerrace\b/g, "Terr."],
];

/** Shorter forms of a name, longest first: before a "/", then abbreviated words. */
export function abbreviations(name: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (t && !out.includes(t) && t !== name) out.push(t);
  };
  const head = name.split(/\s*[/(]\s*/)[0] ?? name;
  add(head);
  let ab = head;
  for (const [re, to] of ABBR) ab = ab.replace(re, to);
  add(ab);
  return out;
}

/** Truncate with an ellipsis to fit `maxPx`; "" if not even one letter fits. */
function truncate(text: string, px: number, maxPx: number): string {
  if (textWidthPx(text, px, "en") <= maxPx) return text;
  for (let n = text.length - 1; n >= 2; n--) {
    const t = `${text.slice(0, n).trimEnd()}…`;
    if (textWidthPx(t, px, "en") <= maxPx) return t;
  }
  return "";
}

export interface LabelInput {
  name: string;
  nameAr?: string | null;
  /** "2.33 × 2.46 m · 6 m²" — dropped first. */
  longMeta?: string | null;
  /** "6 m²" — kept longest. */
  area: string;
  widthPx: number;
  heightPx: number;
  /** The editor's sizes. */
  namePx?: number;
  metaPx?: number;
}

/** The fullest label that fits inside the room's box. */
export function fitRoomLabel({ name, nameAr, longMeta, area, widthPx, heightPx, namePx = 13, metaPx = 11 }: LabelInput): LabelFit {
  const maxW = widthPx - 2 * PAD_X;
  const maxH = heightPx - 2 * PAD_Y;
  const fits = (lines: LabelLine[]) =>
    lines.every((l) => textWidthPx(l.text, l.fontPx, l.kind) <= maxW) && lines.reduce((h, l) => h + l.fontPx * LINE_GAP, 0) <= maxH;
  const ar = nameAr?.trim() || null;
  const names = [name, ...abbreviations(name)];
  const metas = [longMeta, area].filter((m): m is string => !!m);

  // Most to least: every name form × size, with and without Arabic, long → short meta.
  for (const withAr of ar ? [true, false] : [false]) {
    for (const size of [namePx, namePx - 2, namePx - 3]) {
      for (const meta of metas) {
        for (const nm of names) {
          const lines: LabelLine[] = [{ kind: "en", text: nm, fontPx: size }];
          if (withAr) lines.push({ kind: "ar", text: ar!, fontPx: size });
          lines.push({ kind: "meta", text: meta, fontPx: meta === area ? Math.min(metaPx, size) : metaPx });
          if (fits(lines)) return { lines, shortened: nm !== name };
        }
      }
    }
  }
  // A name that fits only truncated, over the area.
  const small = namePx - 3;
  const cut = truncate(names[names.length - 1]!, small, maxW);
  if (cut && fits([{ kind: "en", text: cut, fontPx: small }, { kind: "meta", text: area, fontPx: Math.min(metaPx, small) }])) {
    return { lines: [{ kind: "en", text: cut, fontPx: small }, { kind: "meta", text: area, fontPx: Math.min(metaPx, small) }], shortened: true };
  }
  for (const px of [metaPx, metaPx - 2]) {
    if (fits([{ kind: "meta", text: area, fontPx: px }])) return { lines: [{ kind: "meta", text: area, fontPx: px }], shortened: true };
  }
  return { lines: [], shortened: true };
}

/** Whether a fitted label stays inside the box (the test's check). */
export function labelInside(fit: LabelFit, widthPx: number, heightPx: number): boolean {
  return (
    fit.lines.every((l) => textWidthPx(l.text, l.fontPx, l.kind) <= widthPx - 2 * PAD_X) &&
    fit.lines.reduce((h, l) => h + l.fontPx * LINE_GAP, 0) <= heightPx - 2 * PAD_Y
  );
}

/** A one-line name label (the Openings, Elements and overlay layers): the name, or a shorter form, or nothing. */
export function fitNameLabel(name: string, widthPx: number, heightPx: number, namePx = 12): { text: string; fontPx: number } | null {
  const maxW = widthPx - 2 * PAD_X;
  for (const size of [namePx, namePx - 2, namePx - 3]) {
    if (size * LINE_GAP > heightPx - 2 * PAD_Y) continue;
    for (const nm of [name, ...abbreviations(name)]) if (textWidthPx(nm, size, "en") <= maxW) return { text: nm, fontPx: size };
  }
  const small = namePx - 3;
  if (small * LINE_GAP > heightPx - 2 * PAD_Y) return null;
  const all = [name, ...abbreviations(name)];
  const cut = truncate(all[all.length - 1]!, small, maxW);
  return cut ? { text: cut, fontPx: small } : null;
}
