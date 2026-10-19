// =============================================================================
// lib/timeline/room-programme.ts — a one-room programme from the room's own
// quantities (bathroom pilot B7 1c). Pure.
//
// The villa phase model has a floor (~32 working days) that no single bathroom
// reaches; the pack printed it anyway. This derives each phase from the BoQ's
// own lines at a stated productivity — a bathroom lands around 10–15 working
// days. When the quantities it needs are not on the BoQ (no floor or wall
// tiling), it answers null and the pack drops the page rather than guess.
// =============================================================================

export interface RoomProgrammePhase {
  label: string;
  start_day: number;
  days: number;
  /** How the days were derived: "34.53 m² tiles ÷ 8 m²/day". */
  basis: string;
  /** True when it runs alongside the previous phase (another trade). */
  parallel?: boolean;
}

export interface RoomProgramme {
  total_days: number;
  low_days: number;
  high_days: number;
  phases: RoomProgrammePhase[];
  basis: string;
}

/** Stated productivities — one small crew, one room. */
export const ROOM_RATES = {
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
} as const;

interface LineLike {
  rule_id?: string;
  item_key?: string;
  quantity: number;
  unit?: string;
}

const ceil = (n: number) => Math.max(1, Math.ceil(n - 1e-9));
const q = <L extends LineLike>(lines: readonly L[], pred: (l: L) => boolean) => lines.filter(pred).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
const rule = (l: LineLike) => l.rule_id ?? "";

export function roomProgramme(sections: readonly { work_section: string; lines: readonly LineLike[] }[]): RoomProgramme | null {
  const all = sections.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.work_section })));
  const floorTile = q(all, (l) => rule(l).startsWith("P4/quantify/floor_finish"));
  const wallTile = q(all, (l) => rule(l).startsWith("P4/quantify/wet_tiling"));
  if (!(floorTile > 0) || !(wallTile > 0)) return null;
  const R = ROOM_RATES;
  const strip = q(all, (l) => l.item_key === "demo.wall_tile_removal" || l.item_key === "demo.floor_removal");
  const plumbingPoints = q(all, (l) => /^P2\/overlay\/(wc_point|bidet_point|basin_point|shower_mixer|bath_point|floor_drain|shattaf_point|water_heater)/.test(rule(l)));
  const electricalPoints = q(all, (l) => l.section === "Electrical" && l.unit !== "m2" && l.unit !== "lm");
  const membrane = q(all, (l) => l.item_key === "wp.membrane");
  const screed = q(all, (l) => l.item_key === "floor.screed_wet");
  const ceilingArea = q(all, (l) => l.item_key === "ceiling.repair");
  const fitItems = q(all, (l) => ["Sanitaryware", "Joinery", "Aluminum & Glass"].includes(l.section) && l.unit === "no" && !/^Q-24[abc]/.test(rule(l)));

  const phases: RoomProgrammePhase[] = [];
  let day = 0;
  const seq = (label: string, days: number, basis: string) => {
    phases.push({ label, start_day: day, days, basis });
    day += days;
  };
  seq("Protection & strip-out", strip > 0 ? ceil(strip / R.strip_m2_per_day) : 1, strip > 0 ? `${strip.toFixed(2)} m² of tiles ÷ ${R.strip_m2_per_day} m²/day` : "one day");
  const plumbDays = ceil(plumbingPoints / R.plumbing_points_per_day), elecDays = ceil(electricalPoints / R.electrical_points_per_day);
  seq("First fix — plumbing & electrical", Math.max(plumbDays, elecDays), `${plumbingPoints} plumbing points ÷ ${R.plumbing_points_per_day}/day, ${electricalPoints} electrical ÷ ${R.electrical_points_per_day}/day, side by side`);
  if (screed > 0) seq("Screed to falls + cure", R.screed_days + R.screed_cure_days, `${R.screed_days} day laying, ${R.screed_cure_days} day rapid-set cure`);
  if (membrane > 0) seq("Waterproofing + flood test", ceil((membrane * R.membrane_coats) / R.membrane_m2_per_day) + R.flood_test_days, `${membrane.toFixed(2)} m² × ${R.membrane_coats} coats ÷ ${R.membrane_m2_per_day} m²/day + ${R.flood_test_days} day flood test`);
  const tileStart = day;
  seq("Floor & wall tiling", ceil((floorTile + wallTile) / R.tiling_m2_per_day), `${(floorTile + wallTile).toFixed(2)} m² ÷ ${R.tiling_m2_per_day} m²/day`);
  if (ceilingArea > 0) phases.push({ label: "Ceiling repair & paint", start_day: tileStart, days: ceil((ceilingArea * 2) / R.ceiling_m2_per_day), basis: `${ceilingArea.toFixed(2)} m² (repair + paint) alongside the tiling`, parallel: true });
  seq("Fit-out — sanitaryware, vanity, glass, mirror", fitItems > 0 ? ceil(fitItems / R.fit_items_per_day) : 1, `${fitItems} items ÷ ${R.fit_items_per_day}/day`);
  seq("Snagging, clean & handover", R.clean_days, "one day");

  const total = day;
  return {
    total_days: total,
    low_days: Math.max(1, Math.round(total * 0.8)),
    high_days: Math.round(total * 1.3),
    phases,
    basis: `Derived from this room's own quantities at the productivities beside each phase (one small crew). Excludes lead times for made-to-measure glass and the stone or vanity order, and the building's NOC. Indicative — your contractor's programme decides.`,
  };
}
