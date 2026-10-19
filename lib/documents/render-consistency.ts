// =============================================================================
// lib/documents/render-consistency.ts — may this render go in the pack? (B7 1a)
//
// The G5d rule one level up: a pack never ships a render that contradicts its
// own BoQ. A photo view's render page is included only when the version shown
// matches the CURRENT design:
//
//   1. fixtures — the fixtures the render was held to (its check items, a
//      replaced one counted as gone) are exactly the ones the current BoQ
//      prices (a render with a bidet beside a BoQ with a cabinet is out);
//   2. the anchor — a view renders against the room's anchor: it must follow
//      the CURRENT anchor version (the anchor view: be it);
//   3. products — every finish its follows check read is "same" (a "partly"
//      shower screen is a different product), and its design fingerprint —
//      the fixtures and the room's product choices when it was made — equals
//      today's (a render made before a product swap is out).
//
// Otherwise the page is a labelled placeholder: "View pending — design changed
// in rev N". Pure; the loader hands it plain data.
// =============================================================================

export type FixtureKind = "wc" | "bidet" | "vanity" | "shower" | "bath" | "cabinet";
const FIXTURE_KINDS: readonly FixtureKind[] = ["wc", "bidet", "vanity", "shower", "bath", "cabinet"];

/** The fixtures a BoQ prices: one plumbing point per sanitary fixture (P2), the cabinet as joinery. */
export function boqFixtureKinds(lines: readonly { rule_id?: string; item_key?: string; quantity?: number }[]): Set<FixtureKind> {
  const out = new Set<FixtureKind>();
  const POINT: Record<string, FixtureKind> = { wc_point: "wc", bidet_point: "bidet", basin_point: "vanity", shower_mixer: "shower", bath_point: "bath" };
  for (const l of lines) {
    if ((l.quantity ?? 1) <= 0) continue;
    const point = /^P2\/overlay\/(\w+)/.exec(l.rule_id ?? "")?.[1];
    if (point && POINT[point]) out.add(POINT[point]!);
    if (l.item_key === "joinery.storage_cabinet") out.add("cabinet");
  }
  return out;
}

export interface ViewVersion {
  render_id: string;
  created_at: string;
  /** The check items the render was held to (kinds; a replaced fixture is `gone`). */
  items: readonly { kind: string; gone?: boolean }[];
  /** The anchor version it was rendered against (null = none / it is the anchor view). */
  anchor_render_id: string | null;
  /** Its follows-check reading beside the anchor, when it had one. */
  follows: readonly { element: string; verdict: string }[] | null;
  /** The design fingerprint when it was made (renders since B7; absent before). */
  design_key: string | null;
}

export interface CurrentDesign {
  /** The fixtures the current BoQ prices. */
  fixtures: ReadonlySet<FixtureKind>;
  /** The room's anchor now (null = not anchored). */
  anchor: { render_id: string; room_photo_id: string } | null;
  /** Today's design fingerprint (designKey of the plan's items + the room's choices). */
  design_key: string;
  /** Every BoQ revision, oldest first (rev N = the N-th): when, and its design signature (designSignature). */
  revisions: readonly { created_at: string; signature: string }[];
}

export type Consistency = { ok: true } | { ok: false; reason: string; placeholder: string };

/** Products a client chooses between (a product swap): their item keys mark a design choice. Engine changes never do. */
export const CHOICE_ITEM_KEYS = new Set([
  "alum.shower_panel_fixed", "san.shower_manual", "joinery.vanity_ready", "san.basin_mixer_mid", "san.wc_floor_mid",
  "alum.mirror_led_mid", "wall.shower_niche_plain", "prelim.waste_bagged", "joinery.storage_cabinet",
]);

/**
 * What a revision says the room LOOKS like: the fixtures it prices and the
 * client-chosen products on it. Two revisions with the same signature show the
 * same design (a regeneration or an engine change does not move it); the first
 * that differs is where the design changed.
 */
export function designSignature(sections: readonly { work_section: string; lines: readonly { rule_id?: string; item_key?: string; quantity?: number }[] }[]): string {
  const lines = sections.flatMap((s) => s.lines);
  const kinds = [...boqFixtureKinds(lines)].sort();
  const chosen = [...new Set(lines.filter((l) => (l.quantity ?? 1) > 0 && l.item_key && CHOICE_ITEM_KEYS.has(l.item_key)).map((l) => l.item_key!))].sort();
  return `${kinds.join(",")}|${chosen.join(",")}`;
}

/** The revision the design changed in after a render made at `at`: the first whose signature differs from the one current then. */
function revAfter(at: string, revisions: CurrentDesign["revisions"]): number | null {
  if (revisions.length === 0) return null;
  const then = [...revisions].reverse().find((r) => r.created_at <= at) ?? null;
  if (!then) return 1;
  const i = revisions.findIndex((r) => r.created_at > at && r.signature !== then.signature);
  return i >= 0 ? i + 1 : revisions.length;
}

export function renderConsistency(view: ViewVersion, photoId: string, current: CurrentDesign): Consistency {
  const pending = (reason: string): Consistency => {
    const n = revAfter(view.created_at, current.revisions);
    return { ok: false, reason, placeholder: n ? `View pending — design changed in rev ${n}` : "View pending — design changed" };
  };
  // 1. Fixtures present / absent.
  const rendered = new Set(view.items.filter((i) => !i.gone && (FIXTURE_KINDS as readonly string[]).includes(i.kind)).map((i) => i.kind as FixtureKind));
  const missing = [...current.fixtures].filter((k) => !rendered.has(k));
  const extra = [...rendered].filter((k) => !current.fixtures.has(k));
  if (missing.length || extra.length) return pending(`fixtures differ from the BoQ (${[...extra.map((k) => `has ${k}`), ...missing.map((k) => `no ${k}`)].join(", ")})`);
  // 2. The anchor.
  if (current.anchor) {
    const isAnchorView = current.anchor.room_photo_id === photoId;
    if (isAnchorView ? view.render_id !== current.anchor.render_id : view.anchor_render_id !== current.anchor.render_id) {
      return pending(isAnchorView ? "not the anchor's current version" : "made against an earlier anchor");
    }
  }
  // 3. Products.
  if (view.design_key && view.design_key !== current.design_key) return pending("made before a product or fixture change");
  const off = (view.follows ?? []).filter((e) => e.verdict !== "yes" && e.verdict !== "same" && e.verdict !== "not_visible");
  if (off.length) return pending(`finishes differ from the anchor (${off.map((e) => e.element).join(", ")})`);
  return { ok: true };
}

/** Fixture types a render shows (and the fingerprint covers): the sanitary fixtures, the cabinet, the shattaf. */
const RENDER_TYPES = new Set(["wc_point", "bidet_point", "basin_point", "shower_mixer", "bath_point", "storage_cabinet", "shattaf_point"]);

/**
 * The design fingerprint: the room's render-relevant fixtures (type, what each
 * replaces, a stated height) and its product choices (rooms.spec.wet_room).
 * Stable across key and row order. Fixtures another one replaces are left out.
 */
export function designKey(fixtures: readonly { id?: string; type: string; spec: Record<string, unknown> | null }[], choices: unknown): string {
  const replaced = new Set(fixtures.map((f) => f.spec?.replaces_fixture_id).filter((v): v is string => typeof v === "string"));
  const fx = fixtures
    .filter((f) => RENDER_TYPES.has(f.type) && !(f.id && replaced.has(f.id)))
    .map((f) => `${f.type}${typeof f.spec?.replaces === "string" ? `>${f.spec.replaces}` : ""}${typeof f.spec?.height_mm === "number" ? `@${f.spec.height_mm}` : ""}`)
    .sort();
  const c = choices && typeof choices === "object" ? (choices as Record<string, unknown>) : {};
  const ch = Object.keys(c).filter((k) => k !== "existing_fixtures").sort().map((k) => `${k}=${String(c[k])}`);
  return `${fx.join(",")}|${ch.join(",")}`;
}
