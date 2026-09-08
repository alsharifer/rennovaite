// =============================================================================
// lib/boq/component-dedupe.ts — one owner per physical component (S6-pre).
//
// A component is a PHYSICAL THING a contractor installs: a socket, a water
// heater, a spotlight. The BoQ has four mechanisms that can price one, and
// nothing has ever stopped two of them doing it at once:
//
//   section_rule    the deterministic engine's R-xx rules (lib/boq/rules.ts)
//   catalog_default an accessory_catalog row marked is_rule_default (T3)
//   overlay         a P2 fixture-count line (Electrical Installations, …)
//   actual          a ground-truth transaction line (joinery, aluminum)
//
// Checking Newspace's G13 note found this is not hypothetical. Sockets and
// switches are priced by R-15 in "Electrical" (58 no) AND by the P2 overlay in
// "Electrical Installations" (41 points) — the same sockets, in one BoQ, with
// no dedupe anywhere. Water heaters are duplicated the same way and are only
// invisible because the overlay rate is currently 0 / needs_qs; the day someone
// prices it, the villa buys six heaters for three bathrooms.
//
// So this registry names ONE owner per component and `findComponentDuplicates`
// proves it against a generated BoQ. The rule it enforces is not "these strings
// must not repeat" — it is "this physical thing is bought once".
// =============================================================================

export type PricingMechanism = "section_rule" | "catalog_default" | "overlay" | "actual";

export interface ComponentOwner {
  /** Stable id for the physical component. */
  component: string;
  /** Human label for reports and the summary table. */
  label: string;
  /** The mechanism allowed to price it. Everything else must stay silent. */
  owner: PricingMechanism;
  /** The owning identifier — item_key, rule id, or overlay fixture type. */
  owner_key: string;
  /**
   * R-xx rule id, when the component is priced by an engine rule.
   *
   * A stored BoQ line carries no item_key — only a rule_id like "Q-18/R-15" —
   * so matching on item_key alone finds the owner in a freshly built take-off
   * and never in a persisted BoQ, which is exactly where the check matters.
   */
  owner_rule_id?: string;
  /**
   * Keys belonging to OTHER mechanisms that price the same physical component.
   * Present in the BoQ alongside the owner = a double-count.
   */
  conflicts: { mechanism: PricingMechanism; key: string; rule_id?: string }[];
  /** Delta Log cell that put this component in scope, where one did. */
  source_cell?: string;
  note?: string;
}

export const COMPONENT_OWNERS: ComponentOwner[] = [
  {
    component: "spotlight",
    label: "Ceiling spotlights / LED downlights",
    owner: "section_rule",
    owner_key: "elec.downlight",
    owner_rule_id: "R-14",
    // NOT a conflict. R-14 prices the FITTING (supply + install); the P2
    // overlay "light_point" is the WIRING allowance that feeds it. Two
    // complementary halves of one installation, the same way R-31 cove labour
    // and R-45 strip material are complementary.
    //
    // This was briefly listed as a conflict and the BoQ duly told the QS that
    // spotlights were priced twice. A false duplicate is worse than a missed
    // one: it costs review time and it teaches people to distrust the notice
    // that carries the two real findings.
    conflicts: [],
    source_cell: "G10",
    note:
      "Owner of the fitting itself. The overlay light_point line is the wiring allowance to it, deliberately separate — do not merge them into one line.",
  },
  {
    component: "led_strip",
    label: "Cove LED strip (material)",
    owner: "section_rule",
    owner_key: "light.led_strip",
    owner_rule_id: "R-45",
    conflicts: [],
    source_cell: "G10",
    note:
      "New. R-31 ceiling.led_cove prices the cove LABOUR at AED 45/lm and says 'strips client-supplied', so the strip itself has never been priced. The two are complementary, not duplicates.",
  },
  {
    component: "water_heater",
    label: "Water heaters",
    owner: "section_rule",
    owner_key: "plumb.water_heater",
    owner_rule_id: "R-17",
    conflicts: [{ mechanism: "overlay", key: "water_heater" }],
    source_cell: "G12",
    note:
      "R-17 owns this. The P2 overlay emits its own water_heater line at rate 0 / needs_qs — a live duplicate that costs nothing only because the rate is zero.",
  },
  {
    component: "socket",
    label: "Power sockets",
    owner: "section_rule",
    owner_key: "elec.point",
    owner_rule_id: "R-15",
    conflicts: [
      { mechanism: "overlay", key: "socket_13a" },
      { mechanism: "overlay", key: "switch_1g" },
      { mechanism: "overlay", key: "switch_2way" },
    ],
    source_cell: "G13",
    note:
      "R-15 prices sockets AND switches as one blended 'points' line. The overlay prices all three separately. Both are in the shipped BoQ today.",
  },
  {
    component: "vanity_slab",
    label: "Vanity stone slab",
    owner: "section_rule",
    owner_key: "join.vanity_slab",
    owner_rule_id: "R-46",
    conflicts: [
      { mechanism: "actual", key: "floor.porcelain_material", rule_id: "R-07" },
      { mechanism: "section_rule", key: "join.vanity", rule_id: "R-24" },
    ],
    source_cell: "G19",
    note:
      "Must not be folded into tile area (which would hide it in a QS-validated rate) and must not be assumed inside join.vanity, which the G20 coverage list shows covered the vanity CARCASS only.",
  },
  {
    component: "shower_glass",
    label: "Shower glass partition",
    owner: "section_rule",
    owner_key: "alum.shower_glass",
    owner_rule_id: "R-47",
    conflicts: [],
    source_cell: "G21",
    note: "Aluminum & Glass. No sanitary accessory covers it.",
  },
  {
    component: "mirror",
    label: "Bathroom mirror",
    owner: "section_rule",
    owner_key: "alum.mirror",
    owner_rule_id: "R-48",
    conflicts: [],
    source_cell: "G21",
    note:
      "Aluminum & Glass. The sanitary accessory set is shattaf / paper holder / towel rail / actuator only — deliberately no mirror, so there is nothing to dedupe against.",
  },
  {
    component: "stair_tile",
    label: "Staircase tile (material)",
    owner: "section_rule",
    owner_key: "floor.stair_tile",
    owner_rule_id: "R-44",
    conflicts: [{ mechanism: "section_rule", key: "stairs.renovation", rule_id: "R-36" }],
    source_cell: "G15",
    note:
      "G15 'Only labor'. R-34 stairs.renovation is labour; the tile material comes solely from Q-11b/R-44. Its footprint is already excluded from P4 floor_finish.",
  },
];

/** A line as it appears in a generated BoQ, reduced to what dedupe needs. */
export interface DedupeLine {
  work_section: string;
  description: string;
  item_key?: string | null;
  rule_id?: string | null;
  quantity?: number;
  total_aed?: number;
}

export interface DuplicateFinding {
  component: string;
  label: string;
  owner_key: string;
  /** The conflicting key found alongside the owner. */
  duplicate_key: string;
  duplicate_mechanism: PricingMechanism;
  owner_line: DedupeLine;
  duplicate_line: DedupeLine;
  /** AED carried by the duplicate line — the exposure. */
  duplicate_total_aed: number;
}

/**
 * Match a line to a key. Overlay lines carry their fixture type in the rule_id
 * (`P2/overlay/socket_13a`); engine lines carry an item_key.
 */
function lineMatches(line: DedupeLine, key: string, ruleId?: string): boolean {
  if (line.item_key && line.item_key === key) return true;
  const rid = line.rule_id ?? "";
  if (rid.startsWith("P2/overlay/")) {
    return rid.slice("P2/overlay/".length) === key;
  }
  // Stored BoQ lines look like "Q-18/R-15" — match on the R-xx segment.
  return ruleId ? rid.split("/").includes(ruleId) : false;
}

/**
 * Every component priced by more than one mechanism in the same BoQ.
 * Empty array = the invariant holds.
 */
export function findComponentDuplicates(lines: DedupeLine[]): DuplicateFinding[] {
  const out: DuplicateFinding[] = [];
  for (const owner of COMPONENT_OWNERS) {
    const ownerLine = lines.find((l) => lineMatches(l, owner.owner_key, owner.owner_rule_id));
    if (!ownerLine) continue; // owner not priced in this BoQ — nothing to duplicate
    for (const c of owner.conflicts) {
      const dup = lines.find((l) => lineMatches(l, c.key, c.rule_id));
      if (!dup) continue;
      out.push({
        component: owner.component,
        label: owner.label,
        owner_key: owner.owner_key,
        duplicate_key: c.key,
        duplicate_mechanism: c.mechanism,
        owner_line: ownerLine,
        duplicate_line: dup,
        duplicate_total_aed: dup.total_aed ?? 0,
      });
    }
  }
  return out;
}

/**
 * The components S6-pre ADDS. Used to assert the new work introduced no
 * duplicate of its own, separately from the pre-existing overlay conflicts —
 * so a legacy defect can never mask a new one.
 */
export const S6_NEW_COMPONENTS = [
  "led_strip",
  "vanity_slab",
  "shower_glass",
  "mirror",
] as const;

export function findNewComponentDuplicates(lines: DedupeLine[]): DuplicateFinding[] {
  const isNew = new Set<string>(S6_NEW_COMPONENTS);
  return findComponentDuplicates(lines).filter((f) => isNew.has(f.component));
}

export function ownerFor(component: string): ComponentOwner | undefined {
  return COMPONENT_OWNERS.find((c) => c.component === component);
}
