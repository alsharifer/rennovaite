// =============================================================================
// lib/boq/install-classes.ts — a product swap can move SCOPE, not only a rate (C3).
//
// B7 5 assumed choosing another product moves only its rate. The review showed
// it can move the work around it: a concealed thermostatic valve → an exposed
// set drops the chase and the make-good in the wall; a floor-standing WC → a
// wall-hung one adds a frame, a concealed cistern and a duct wall. So every
// product group's options carry an INSTALL CLASS (lib/boq/product-swaps.ts):
//
//   a swap within a class  rate only — the product line changes, nothing else
//   a swap across classes  the dependent lines are RECOMPUTED by rule, where a
//                          rule exists (WC wall-hung: R-19 frame + WC, R-43
//                          flush plate, R-63 duct wall); otherwise they are
//                          marked "Scope review needed — <what changed>" — the
//                          Issues navigator lists them and the export is
//                          blocked until a member marks them reviewed.
//
// The dependent lines are priced for the BASE class (concealed shower, floor-
// standing WC, basin on a vanity), so a flag is a function of the CURRENT
// choice and the review record — never of remembering the swap. Pure.
// =============================================================================

export type InstallField = "shower_valve" | "wc_mount" | "basin_mount";

export interface ClassChange {
  field: InstallField;
  /** The class the dependent lines were priced for, and the class chosen. */
  from: string;
  to: string;
  mode: "recompute" | "review";
  /** What changed, in the words the flag and the navigator print. */
  what: string;
  /** The lines priced for `from` — by item_key, or rule id (GT/…, P2/…) where a line has none. */
  dependent: readonly string[];
}

/** The class every dependent line is priced for. */
export const BASE_CLASS: Record<InstallField, string> = { shower_valve: "concealed", wc_mount: "floor_standing", basin_mount: "on_vanity" };

/** Each option's install class, by field and option value. */
export const OPTION_CLASS: Record<InstallField, Record<string, string>> = {
  shower_valve: { thermostatic: "concealed", manual: "concealed", exposed: "exposed" },
  wc_mount: { floor_standing: "floor_standing", wall_hung: "wall_hung" },
  basin_mount: { on_vanity: "on_vanity", wall_hung: "wall_hung" },
};

const CLASS_LABEL: Record<string, string> = { concealed: "concealed shower valve", exposed: "exposed shower set", floor_standing: "floor-standing WC", wall_hung: "wall-hung", on_vanity: "basin on a vanity" };

/** The minimum rules (C3): one per cross-class change away from the base. */
export const CLASS_CHANGES: readonly ClassChange[] = [
  {
    field: "shower_valve",
    from: "concealed",
    to: "exposed",
    mode: "review",
    what: "shower valve concealed → exposed: the supply point was priced as a concealed first fix (chase the wall, valve body behind the tiles, make good)",
    dependent: ["P2/overlay/shower_mixer"],
  },
  {
    field: "wc_mount",
    from: "floor_standing",
    to: "wall_hung",
    mode: "recompute",
    what: "WC floor-standing → wall-hung: frame + concealed cistern, flush plate and a tiled duct wall, priced by rule (R-19, R-43, R-63)",
    dependent: ["san.wc_floor", "san.wc_floor_mid"],
  },
  {
    field: "basin_mount",
    from: "on_vanity",
    to: "wall_hung",
    mode: "review",
    what: "basin on a vanity → wall-hung: the vanity and its top may no longer be needed, and the basin waste first fix moves into the wall",
    dependent: ["joinery.vanity_ready", "GT/joinery/vanity", "S6-05", "san.basin", "san.basin_mixer_mid", "P2/overlay/basin_point"],
  },
];

/** A stored line's identity for the dependent lists. */
export function installLineKey(line: { item_key?: string | null; rule_id?: string | null }): string {
  if (line.item_key) return line.item_key;
  const r = line.rule_id ?? "";
  return r.startsWith("GT/") || r.startsWith("P2/") ? r : r.split("/")[0]!;
}

/** The class an option puts a field in (unknown field/value → the base class). */
export function classOf(field: InstallField, value: unknown): string {
  return OPTION_CLASS[field][String(value)] ?? BASE_CLASS[field];
}

/** The change a CURRENT choice makes against the base, or null (within the base class). */
export function changeFor(field: InstallField, value: unknown): ClassChange | null {
  const to = classOf(field, value);
  if (to === BASE_CLASS[field]) return null;
  return CLASS_CHANGES.find((c) => c.field === field && c.from === BASE_CLASS[field] && c.to === to) ?? null;
}

/** The review key a member records ("shower_valve:exposed") — a new swap of the field needs a new review. */
export const reviewKey = (field: InstallField, value: unknown) => `${field}:${String(value)}`;

/** What a swap from one option to another does to the install: rate only, recompute by rule, or a scope review. */
export function swapEffect(field: string, from: unknown, to: unknown): { kind: "rate_only" } | { kind: "recompute" | "review"; what: string } {
  if (!(field in OPTION_CLASS)) return { kind: "rate_only" };
  const f = field as InstallField;
  if (classOf(f, from) === classOf(f, to)) return { kind: "rate_only" };
  // Back to the base class: the dependent lines are priced for it as they stand.
  if (classOf(f, to) === BASE_CLASS[f]) return { kind: "recompute", what: `${CLASS_LABEL[classOf(f, from)] ?? classOf(f, from)} → ${CLASS_LABEL[BASE_CLASS[f]]}: the lines priced for it apply again` };
  const c = changeFor(f, to);
  return c ? { kind: c.mode, what: c.what } : { kind: "review", what: `${CLASS_LABEL[classOf(f, from)] ?? classOf(f, from)} → ${CLASS_LABEL[classOf(f, to)] ?? classOf(f, to)}: no rule prices the change` };
}

/** The scope reviews still open for a room's choices — those flagged on the BoQ. */
export function openReviews(choices: Partial<Record<InstallField, unknown>>, reviewed: readonly string[] = []): ClassChange[] {
  return (Object.keys(OPTION_CLASS) as InstallField[])
    .map((f) => ({ f, c: changeFor(f, choices[f]) }))
    .filter((x): x is { f: InstallField; c: ClassChange } => !!x.c && x.c.mode === "review" && !reviewed.includes(reviewKey(x.f, choices[x.f])))
    .map((x) => x.c);
}

export const SCOPE_REVIEW_PREFIX = "Scope review needed — ";
