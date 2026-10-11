// =============================================================================
// lib/firms/magnitude.ts — the magnitude / unit sanity check on a firm rate (H8).
//
// A rate is compared with the reference it would shadow. Outside
// [MAGNITUDE_LOW, MAGNITUDE_HIGH] × the reference it is HELD with the reason
// "rate is N× the reference — check the unit": almost always a rate for a
// different unit (a whole pergola "per no" read as "per m² plan"). Accepting it
// anyway is an explicit act (recorded as an event).
//
// Where the description carries dimensions that resolve to the item's unit —
// "Aluminium louvred pergola 3.5 x 3.5 m", quoted 1 no at 24,500 against an
// item priced per m² plan — the converted rate is OFFERED, never applied:
// 24,500 ÷ 12.25 m² = 2,000.00 / m² plan.
//
// Pure and client-safe (the book editor checks as the member types).
// =============================================================================

export const MAGNITUDE_HIGH = 3;
export const MAGNITUDE_LOW = 0.33;

export interface MagnitudeCheck {
  ratio: number;
  outlier: boolean;
  /** The hold text, or null when within range. */
  reason: string | null;
}

const fmtRatio = (r: number) => (r >= 10 ? r.toFixed(1) : r >= 1 ? r.toFixed(1) : r.toFixed(2)).replace(/\.0$/, "");

/** The check against a reference rate; null when there is no single reference figure to check against. */
export function checkMagnitude(rate_aed: number, reference_aed: number | null | undefined): MagnitudeCheck | null {
  if (reference_aed == null || !(reference_aed > 0) || !Number.isFinite(rate_aed) || rate_aed < 0) return null;
  const ratio = Math.round((rate_aed / reference_aed) * 100) / 100;
  const outlier = ratio > MAGNITUDE_HIGH || ratio < MAGNITUDE_LOW;
  return { ratio, outlier, reason: outlier ? `rate is ${fmtRatio(ratio)}× the reference — check the unit` : null };
}

/** Units a quote line uses for "one of a thing" — the units a dimension can convert FROM. */
const COUNT_UNITS = new Set(["no", "nr", "nos", "item", "each", "ea", "set", "lump", "ls", "unit", "pc", "pcs"]);
/** Item units measured as an area — the units two dimensions convert TO. */
const AREA_UNITS = new Set(["m2", "m²", "m2 plan", "m² plan", "sqm"]);
/** Item units measured as a length — the unit one dimension converts TO. */
const LENGTH_UNITS = new Set(["lm", "m", "rm"]);

const TO_M: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1 };

/** Dimensions written in a description, in metres: "3.5 x 3.5 m" → [3.5, 3.5]; "2400 × 1200 mm" → [2.4, 1.2]. */
export function parseDimensions(description: string): number[] | null {
  const m = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(mm|cm|m)\b/i.exec(description);
  if (m) {
    const k = TO_M[m[4]!.toLowerCase()]!;
    return [m[1], m[2], m[3]].filter((x): x is string => x != null).map((x) => Math.round(Number(x) * k * 1000) / 1000);
  }
  const one = /(\d+(?:\.\d+)?)\s*(mm|cm|m)\b(?!\s*[²2])/i.exec(description);
  if (one) return [Math.round(Number(one[1]) * TO_M[one[2]!.toLowerCase()]! * 1000) / 1000];
  return null;
}

export interface ConversionOffer {
  rate_aed: number;
  quantity: number;
  unit: string;
  /** m² or m per quoted unit. */
  per_unit: number;
  ratio: number | null;
  note: string;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A converted rate the review screen can OFFER: the quoted line was "one of a
 * thing" (count unit), the item is priced per area or length, and the
 * description carries the dimensions that turn one into the other. Null
 * otherwise — never a guess.
 */
export function conversionOffer(input: {
  description: string;
  rate_aed: number;
  quantity: number | null;
  unit_given: string | null;
  item_unit: string | null;
  reference_aed?: number | null;
}): ConversionOffer | null {
  const given = (input.unit_given ?? "").trim().toLowerCase();
  const target = (input.item_unit ?? "").trim().toLowerCase();
  if (!COUNT_UNITS.has(given) || !target) return null;
  const dims = parseDimensions(input.description);
  if (!dims) return null;
  let per: number;
  let how: string;
  if (AREA_UNITS.has(target) && dims.length >= 2) {
    per = Math.round(dims[0]! * dims[1]! * 100) / 100;
    how = `${dims[0]} × ${dims[1]} m = ${per} m²`;
  } else if (LENGTH_UNITS.has(target) && dims.length === 1) {
    per = dims[0]!;
    how = `${per} m`;
  } else return null;
  if (!(per > 0)) return null;
  const rate = Math.round((input.rate_aed / per) * 100) / 100;
  const qty = Math.round((input.quantity ?? 1) * per * 100) / 100;
  const check = checkMagnitude(rate, input.reference_aed);
  return {
    rate_aed: rate,
    quantity: qty,
    unit: input.item_unit!,
    per_unit: per,
    ratio: check?.ratio ?? null,
    note: `${money(input.rate_aed)} per ${input.unit_given} ÷ ${per} (${how}) = ${money(rate)} / ${input.item_unit}`,
  };
}
