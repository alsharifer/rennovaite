// Small display helpers for the BoQ & Review screen (K3). Pure, client-safe.

/** The stored unit as it is printed: "m2" → "m²", "m3" → "m³". */
export function displayUnit(unit: string): string {
  return unit.replace(/\bm2\b/g, "m²").replace(/\bm3\b/g, "m³");
}

/** "1 line", "6 lines". */
export function linesWord(n: number): string {
  return `${n} ${n === 1 ? "line" : "lines"}`;
}

/** A compact index subtotal: whole dirhams, grouped ("33,666"). */
export function wholeAed(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
