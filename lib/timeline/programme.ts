// =============================================================================
// lib/timeline/programme.ts — THE schedule engine (Sprint C4). Pure.
//
// One programme per project, derived from the BoQ's own quantities at stated
// productivities — the bathroom pilot's method (B7 1c), generalised. Every
// surface reads this function: the Overview, 05 Timeline, the BoQ page's
// programme, the BoQ PDF, the proposal, the room pack and the hub. There is no
// other engine:
//   - the villa phase model ("8–14 weeks", scaled from one villa's contract
//     phases) is RETIRED — lib/timeline/estimate.ts, anchors.ts, drivers.ts;
//   - the garden programme scaled by BoQ VALUE from one garden's 90 days
//     (clamped at 1.5× — the 135-day output) is RETIRED — lib/boq/programme.ts.
//   Their reference projects stay as the calibration record:
//   lib/timeline/__tests__/programme.test.ts prints each one's derived working
//   days beside its recorded calendar span — reconciled, not tuned.
//
// What it is and is not: WORKING days of site work at the productivity beside
// each phase, for one site team. It EXCLUDES lead times
// (made-to-measure glass, stone, joinery, a pergola's fabrication), permits and
// NOCs, curing beyond the stated days and weekends. Indicative — the
// contractor's programme decides.
//
// One site team at the productivities below — calibrated on the reference
// villa, whose recorded strip-out (14 days) and ceilings (12) the stated rates
// reproduce exactly; a garden has its own crew, working alongside the interior.
// The pilot bathroom's 14 days are unchanged.
// =============================================================================

export interface ProgrammePhase {
  label: string;
  /** 0-based working day the phase starts. */
  start_day: number;
  days: number;
  /** How the days were derived: "34.53 m² ÷ 8 m²/day". */
  basis: string;
  /** True when it runs alongside another phase (another trade or crew). */
  parallel?: boolean;
}

import { lineItemKey } from "@/lib/boq/line-identity";

export interface Programme {
  indicative: true;
  provenance: "derived";
  /** Working days, start to handover — THE number every surface prints. */
  total_days: number;
  low_days: number;
  high_days: number;
  phases: ProgrammePhase[];
  basis: string;
}

/** Stated productivities — per crew per working day. */
export const PRODUCTIVITY = {
  // The pilot bathroom's (B7 1c), unchanged.
  strip_m2_per_day: 40,
  plumbing_points_per_day: 5,
  electrical_points_per_day: 8,
  screed_days: 1,
  screed_cure_days: 1,
  membrane_m2_per_day: 30,
  membrane_coats: 2,
  flood_test_days: 1,
  tiling_m2_per_day: 8,
  ceiling_m2_per_day: 10,
  fit_items_per_day: 4,
  clean_days: 1,
  // A whole home (C4).
  civil_alteration_days: 3,
  gypsum_ceiling_m2_per_day: 15,
  paint_m2_per_day: 40,
  // A garden (C4) — its own crew.
  garden_mobilise_days: 2,
  garden_strip_days: 3,
  hardscape_m2_per_day: 12,
  structure_m2_per_day: 4,
  run_lm_per_day: 2,
  unit_days: 2,
  softscape_m2_per_day: 50,
  planting_m2_per_day: 20,
  irrigation_days: 3,
  garden_points_per_day: 6,
} as const;


interface LineLike {
  rule_id?: string | null;
  item_key?: string | null;
  description?: string;
  quantity: number;
  unit?: string | null;
  total_aed?: number;
  element_refs?: readonly string[] | null;
}

const ceil = (n: number) => Math.max(1, Math.ceil(n - 1e-9));
const rule = (l: LineLike) => l.rule_id ?? "";
/** A line's item key — stored, or derived from its rule (a revision stored before U4 has none). */
const key = (l: LineLike) => lineItemKey({ item_key: l.item_key ?? undefined, rule_id: l.rule_id ?? undefined, description: l.description ?? "" }) ?? "";

export function programmeOf(boq: { sections: readonly { work_section: string; lines: readonly LineLike[] }[] } | null | undefined): Programme | null {
  if (!boq?.sections?.length) return null;
  const all = boq.sections.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.work_section })));
  const q = (pred: (l: (typeof all)[number]) => boolean) => all.filter(pred).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const has = (pred: (l: (typeof all)[number]) => boolean) => all.some((l) => pred(l) && (Number(l.quantity) || 0) > 0);
  const P = PRODUCTIVITY;

  // --- interior quantities (the room pilot's lines, and a home's) ---
  const floorTile = q((l) => rule(l).startsWith("P4/quantify/floor_finish"));
  const wallTile = q((l) => rule(l).startsWith("P4/quantify/wet_tiling"));
  const stairTile = q((l) => key(l) === "floor.stair_tile");
  const strip = q((l) => key(l) === "demo.wall_tile_removal" || key(l) === "demo.floor_removal" || rule(l).startsWith("P4/quantify/demolition"));
  const plumbingPoints = q((l) => /^P2\/overlay\/(wc_point|bidet_point|basin_point|shower_mixer|bath_point|floor_drain|shattaf_point|water_heater|kitchen_sink)/.test(rule(l)));
  const electricalPoints = q((l) => l.section === "Electrical" && l.unit !== "m2" && l.unit !== "lm");
  const membrane = q((l) => key(l) === "wp.membrane");
  const screed = q((l) => key(l) === "floor.screed_wet");
  const ceilingRepair = q((l) => key(l) === "ceiling.repair");
  const gypsum = q((l) => rule(l).startsWith("P4/quantify/ceiling_finish"));
  const paint = q((l) => rule(l).startsWith("P4/quantify/wall_paint"));
  const fitItems = q((l) => ["Sanitaryware", "Joinery", "Aluminum & Glass"].includes(l.section) && l.unit === "no" && !/^Q-24[abc]/.test(rule(l)));
  const civil = has((l) => rule(l).startsWith("Q-05"));
  const interior = floorTile > 0 || wallTile > 0 || gypsum > 0 || paint > 0;

  // --- garden quantities (GL- lines) ---
  const gl = (k: string) => q((l) => key(l) === k);
  const hardscape = (gl("garden.paving_install") || gl("garden.pcc_base")) + gl("garden.deck") + gl("garden.stepping_path");
  const structures = gl("garden.pergola");
  const runs = q((l) => /^garden\.(counter_bbq|counter_bar|bench_run|planter_bench_run)$/.test(key(l)));
  const units = q((l) => /^garden\.(planter_box|wall_feature|shed)$/.test(key(l)));
  const grass = gl("garden.grass_install") || gl("garden.grass_supply");
  const planting = gl("garden.planting_bed");
  const gardenPoints = q((l) => /^garden\.(light_fitting|boundary_light|water_tap)$/.test(key(l)));
  const irrigation = has((l) => key(l) === "garden.irrigation");
  const gardenDemo = has((l) => key(l) === "garden.demolition");
  const garden = hardscape > 0 || structures > 0 || runs > 0 || units > 0 || grass > 0 || planting > 0;

  if (!interior && !garden) return null;

  const by = (qty: number, rate: number) => ceil(qty / rate);

  const phases: ProgrammePhase[] = [];
  let day = 0;
  const seq = (label: string, days: number, basis: string) => {
    phases.push({ label, start_day: day, days, basis });
    day += days;
  };

  if (interior) {
    seq("Protection & strip-out", strip > 0 ? by(strip, P.strip_m2_per_day) : 1, strip > 0 ? `${strip.toFixed(2)} m² of strip-out ÷ ${P.strip_m2_per_day} m²/day` : "one day");
    if (civil) seq("Civil alterations", P.civil_alteration_days, `${P.civil_alteration_days} days for the alterations allowance`);
    const plumbDays = by(plumbingPoints, P.plumbing_points_per_day), elecDays = by(electricalPoints, P.electrical_points_per_day);
    seq("First fix — plumbing & electrical", Math.max(plumbDays, elecDays), `${plumbingPoints} plumbing points ÷ ${P.plumbing_points_per_day}/day, ${electricalPoints} electrical ÷ ${P.electrical_points_per_day}/day, side by side`);
    if (gypsum > 0) seq("Ceilings", by(gypsum, P.gypsum_ceiling_m2_per_day), `${gypsum.toFixed(2)} m² of ceiling ÷ ${P.gypsum_ceiling_m2_per_day} m²/day`);
    if (screed > 0) seq("Screed to falls + cure", P.screed_days + P.screed_cure_days, `${P.screed_days} day laying, ${P.screed_cure_days} day rapid-set cure`);
    if (membrane > 0) seq("Waterproofing + flood test", by(membrane * P.membrane_coats, P.membrane_m2_per_day) + P.flood_test_days, `${membrane.toFixed(2)} m² × ${P.membrane_coats} coats ÷ ${P.membrane_m2_per_day} m²/day + ${P.flood_test_days} day flood test`);
    const tiles = floorTile + wallTile + stairTile;
    const tileStart = day;
    if (tiles > 0) seq("Floor & wall tiling", by(tiles, P.tiling_m2_per_day), `${tiles.toFixed(2)} m² ÷ ${P.tiling_m2_per_day} m²/day`);
    if (ceilingRepair > 0) phases.push({ label: "Ceiling repair & paint", start_day: tileStart, days: by(ceilingRepair * 2, P.ceiling_m2_per_day), basis: `${ceilingRepair.toFixed(2)} m² (repair + paint) alongside the tiling`, parallel: true });
    if (paint > 0) {
      const d = by(paint, P.paint_m2_per_day);
      phases.push({ label: "Painting & electrical second fix", start_day: tileStart, days: d, basis: `${paint.toFixed(2)} m² of wall paint ÷ ${P.paint_m2_per_day} m²/day, alongside the tiling`, parallel: true });
      day = Math.max(day, tileStart + d);
    }
    seq("Fit-out — sanitaryware, joinery, glass, mirrors", fitItems > 0 ? by(fitItems, P.fit_items_per_day) : 1, `${fitItems} items ÷ ${P.fit_items_per_day}/day`);
  }

  // The garden: its own crew — alongside the interior (from day 0) or the whole job.
  if (garden) {
    let g = 0;
    const gseq = (label: string, days: number, basis: string) => {
      phases.push({ label, start_day: g, days, basis, ...(interior ? { parallel: true } : {}) });
      g += days;
    };
    gseq("Garden — mobilisation & setting out", P.garden_mobilise_days, `${P.garden_mobilise_days} days`);
    if (gardenDemo) gseq("Garden — demolition & clearance", P.garden_strip_days, `${P.garden_strip_days} days for the strip-out`);
    const hard = (hardscape > 0 ? hardscape / P.hardscape_m2_per_day : 0) + (structures > 0 ? structures / P.structure_m2_per_day : 0) + (runs > 0 ? runs / P.run_lm_per_day : 0) + units * P.unit_days;
    if (hard > 0) gseq("Garden — hardscape & structures", ceil(hard), [hardscape > 0 ? `${hardscape.toFixed(2)} m² paving and decking ÷ ${P.hardscape_m2_per_day} m²/day` : "", structures > 0 ? `${structures.toFixed(2)} m² of structure ÷ ${P.structure_m2_per_day} m²/day` : "", runs > 0 ? `${runs.toFixed(2)} lm of counters and benches ÷ ${P.run_lm_per_day} lm/day` : "", units > 0 ? `${units} built unit${units === 1 ? "" : "s"} × ${P.unit_days} days` : ""].filter(Boolean).join(" + "));
    const soft = (grass > 0 ? grass / P.softscape_m2_per_day : 0) + (planting > 0 ? planting / P.planting_m2_per_day : 0) + (irrigation ? P.irrigation_days : 0) + (gardenPoints > 0 ? gardenPoints / P.garden_points_per_day : 0);
    if (soft > 0) gseq("Garden — soft landscaping, irrigation & lighting", ceil(soft), [grass > 0 ? `${grass.toFixed(2)} m² grass ÷ ${P.softscape_m2_per_day} m²/day` : "", planting > 0 ? `${planting.toFixed(2)} m² planting ÷ ${P.planting_m2_per_day} m²/day` : "", irrigation ? `${P.irrigation_days} days irrigation` : "", gardenPoints > 0 ? `${gardenPoints} light / tap points ÷ ${P.garden_points_per_day}/day` : ""].filter(Boolean).join(" + "));
    day = Math.max(day, g);
  }

  seq("Snagging, clean & handover", P.clean_days, "one day");

  const total = day;
  return {
    indicative: true,
    provenance: "derived",
    total_days: total,
    low_days: Math.max(1, Math.round(total * 0.8)),
    high_days: Math.round(total * 1.3),
    phases,
    basis: `Working days, derived from this BoQ's own quantities at the productivities beside each phase (one site team${garden && interior ? ", a garden crew alongside" : ""}). Excludes lead times (made-to-measure glass, stone, joinery, fabricated structures), permits and NOCs, and weekends. Indicative — your contractor's programme decides.`,
  };
}

/** "≈ 14 working days (11–18)" — the one way a surface prints the number. */
export function programmeLabel(p: Pick<Programme, "total_days" | "low_days" | "high_days">): string {
  return `≈ ${p.total_days} working days (${p.low_days}–${p.high_days})`;
}

/** The programme as the documents and the BoQ page draw it: phases named, days counted from 1. */
export interface DocProgramme {
  total_days: number;
  low_days: number;
  high_days: number;
  phases: { name: string; start_day: number; days: number; basis: string; parallel?: boolean }[];
  basis: string;
}

/** C4: what the BoQ page, the BoQ PDF, the proposal and the hub read — `programmeOf`, never a stored figure. */
export function docProgramme(boq: Parameters<typeof programmeOf>[0]): DocProgramme | null {
  const p = programmeOf(boq);
  if (!p) return null;
  return {
    total_days: p.total_days,
    low_days: p.low_days,
    high_days: p.high_days,
    phases: p.phases.map((ph) => ({ name: ph.label, start_day: ph.start_day + 1, days: ph.days, basis: ph.basis, ...(ph.parallel ? { parallel: true } : {}) })),
    basis: p.basis,
  };
}
