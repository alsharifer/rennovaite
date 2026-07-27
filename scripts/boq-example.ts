// =============================================================================
// scripts/boq-example.ts — run the deterministic BoQ engine offline against
// the CSVs in /assets and the canonical Mudon first-floor fixture.
//
//   npx tsx scripts/boq-example.ts [style-key]
//
// No Supabase, no API keys, no network. Writes:
//   docs/boq-example.json      — full engine output
//   docs/QS_REVIEW_PACK.md     — worked BoQ + every rule/factor, for QS markup
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";

import { generateDeterministicBoq } from "../lib/boq/engine";
import { MUDON_FIRST_FLOOR } from "../lib/boq/fixtures/mudon-first-floor";
import {
  CONSTANTS,
  CONTINGENCY_PCT,
  ENGINE_VERSION,
  PLASTER_MAKEGOOD_FACTOR,
  RATE_RULES,
  STYLE_FLOORING,
  STYLE_TIER,
  TIER_LABOUR_BAND,
  TIER_SKU_PERCENTILE,
  VAT_PCT,
  WASTAGE,
} from "../lib/boq/rules";
import type { LabourRate, PricingSku } from "../lib/boq/schema";

const ROOT = path.resolve(__dirname, "..");

// --- minimal RFC-4180 CSV parser (handles quoted fields with commas) ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.length > 0)) rows.push(row);
  }
  return rows;
}

function loadLabourRates(): LabourRate[] {
  const rows = parseCsv(
    fs.readFileSync(path.join(ROOT, "assets", "labour-rates.csv"), "utf8"),
  );
  const [header, ...data] = rows;
  const col = (name: string) => header!.indexOf(name);
  return data.map((r) => ({
    work_section: r[col("work_section")] ?? "",
    description: r[col("description")] ?? "",
    unit: r[col("unit")] ?? "",
    rate_low_aed: Number(r[col("rate_low_aed")] ?? 0),
    rate_mid_aed: Number(r[col("rate_mid_aed")] ?? 0),
    rate_high_aed: Number(r[col("rate_high_aed")] ?? 0),
  }));
}

function loadSkus(): PricingSku[] {
  const rows = parseCsv(
    fs.readFileSync(path.join(ROOT, "assets", "pricing_skus.csv.csv"), "utf8"),
  );
  const [header, ...data] = rows;
  const col = (name: string) => header!.indexOf(name);
  return data
    .map((r) => ({
      sku: r[col("SKU")] ?? "",
      brand: r[col("Brand")] ?? "",
      category: r[col("Category")] ?? "",
      subcategory: r[col("Subcategory")] ?? "",
      description_en: r[col("Description_en")] ?? "",
      unit: r[col("Unit")] ?? "",
      price_aed: Number(r[col("Price_aed")] ?? 0),
      vendor: r[col("Vendor")] ?? "",
    }))
    .filter((s) => s.sku && s.price_aed > 0);
}

// --- run -----------------------------------------------------------------------

const styleKey = process.argv[2] ?? "contemporary-majlis";
const labourRates = loadLabourRates();
const skus = loadSkus();

const { boq, takeoff } = generateDeterministicBoq({
  rooms: MUDON_FIRST_FLOOR,
  labourRates,
  skus,
  styleKey,
});

// Determinism check: run twice, compare everything except the timestamp.
const second = generateDeterministicBoq({
  rooms: MUDON_FIRST_FLOOR,
  labourRates,
  skus,
  styleKey,
});
const stripTs = (b: typeof boq) =>
  JSON.stringify({ ...b, engine: { ...b.engine, generated_at: "" } });
if (stripTs(boq) !== stripTs(second.boq)) {
  throw new Error("DETERMINISM CHECK FAILED: two runs differ.");
}

// Arithmetic check: recompute every total independently.
let recomputedSubtotal = 0;
for (const s of boq.sections) {
  const sum = s.lines.reduce(
    (acc, l) => acc + Math.round(l.quantity * l.rate_aed),
    0,
  );
  if (sum !== s.section_total_aed) {
    throw new Error(`ARITHMETIC CHECK FAILED in section ${s.work_section}`);
  }
  recomputedSubtotal += sum;
}
if (recomputedSubtotal !== boq.subtotal_aed) {
  throw new Error("ARITHMETIC CHECK FAILED: subtotal mismatch.");
}
const expectGrand =
  boq.subtotal_aed +
  Math.round((boq.subtotal_aed * CONTINGENCY_PCT) / 100) +
  Math.round(
    ((boq.subtotal_aed + Math.round((boq.subtotal_aed * CONTINGENCY_PCT) / 100)) *
      VAT_PCT) /
      100,
  );
if (expectGrand !== boq.grand_total_aed) {
  throw new Error("ARITHMETIC CHECK FAILED: grand total mismatch.");
}

// --- console summary -------------------------------------------------------------

const aed = (n: number) => `AED ${n.toLocaleString("en-US")}`;
console.log(
  `\nDeterministic BoQ v${ENGINE_VERSION} — Mudon first-floor refit — style=${styleKey} (tier=${boq.engine.tier}, floor=${boq.engine.flooring})\n`,
);
for (const s of boq.sections) {
  console.log(`  ${s.work_section.padEnd(24)} ${aed(s.section_total_aed).padStart(14)}  (${s.lines.length} lines)`);
}
console.log(`  ${"-".repeat(44)}`);
console.log(`  ${"Subtotal".padEnd(24)} ${aed(boq.subtotal_aed).padStart(14)}`);
console.log(`  ${"Contingency 8%".padEnd(24)} ${aed(boq.contingency_aed).padStart(14)}`);
console.log(`  ${"VAT 5%".padEnd(24)} ${aed(boq.vat_aed).padStart(14)}`);
console.log(`  ${"GRAND TOTAL".padEnd(24)} ${aed(boq.grand_total_aed).padStart(14)}`);
console.log("\n  Determinism check: PASS   Arithmetic check: PASS\n");

// --- write outputs ----------------------------------------------------------------

const docsDir = path.join(ROOT, "docs");
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(
  path.join(docsDir, "boq-example.json"),
  JSON.stringify({ takeoff, boq }, null, 2),
);

// QS review pack -------------------------------------------------------------------

const md: string[] = [];
md.push(`# RennovAIte — QS Review Pack`);
md.push(``);
md.push(
  `Deterministic BoQ engine v${ENGINE_VERSION} · generated ${new Date().toISOString().slice(0, 10)} · pilot: Mudon Al Naseem 4BR villa, first-floor refit · style: ${styleKey} (tier ${boq.engine.tier}, ${boq.engine.flooring} flooring)`,
);
md.push(``);
md.push(
  `Every quantity, rate, and factor below is produced by a rules engine (no AI in the pricing path). Each carries a rule ID. **We are asking you to mark up: (a) wrong or missing factors, (b) wrong measurement conventions, (c) unrealistic rates, (d) missing line items.** Corrections are applied to the rules table and the whole model re-prices.`,
);
md.push(``);

md.push(
  `## 1. Rooms (calibrated to Villa 94 shop drawings + SoW — see QS_PACK_VALIDATION.md)`,
);
md.push(``);
md.push(`| Room | Type | Area m² |`);
md.push(`|---|---|---|`);
for (const r of MUDON_FIRST_FLOOR) {
  md.push(`| ${r.name} | ${r.room_type} | ${r.area_m2} |`);
}
md.push(`| **Total** | | **${takeoff.summary.totalAreaM2}** |`);
md.push(``);

md.push(`## 2. Constants and factors under review`);
md.push(``);
md.push(`| ID | Constant | Value | QS correction |`);
md.push(`|---|---|---|---|`);
md.push(`| C-01 | Wall height (slab to ceiling) | ${CONSTANTS.WALL_HEIGHT_M} m | |`);
md.push(`| C-02 | Door opening | ${CONSTANTS.DOOR_W_M} × ${CONSTANTS.DOOR_H_M} m | |`);
md.push(`| C-03 | Window deduction, dry rooms | ${CONSTANTS.WINDOW_DEDUCTION_PCT * 100}% of gross wall | |`);
md.push(`| C-04 | Bathroom tile height | ${CONSTANTS.BATH_TILE_HEIGHT_M} m | |`);
md.push(`| C-06 | Debris volume proxy | ${CONSTANTS.DEBRIS_M3_PER_M2} m³/m² | |`);
md.push(`| C-07 | Skip capacity | ${CONSTANTS.SKIP_CAPACITY_M3} m³ | |`);
md.push(`| W-01 | Floor tile wastage | ${WASTAGE.FLOOR_TILE * 100}% | |`);
md.push(`| W-02 | Engineered wood wastage | ${WASTAGE.ENGINEERED_WOOD * 100}% | |`);
md.push(`| W-03 | Wall tile wastage | ${WASTAGE.WALL_TILE * 100}% | |`);
md.push(`| F-05 | Plaster make-good share of net wall | ${PLASTER_MAKEGOOD_FACTOR * 100}% | |`);
md.push(`| P-01 | Contingency | ${CONTINGENCY_PCT}% | |`);
md.push(`| P-02 | VAT | ${VAT_PCT}% | |`);
md.push(``);
md.push(
  `Tier policy: labour band by tier = ${JSON.stringify(TIER_LABOUR_BAND)}; SKU price percentile by tier = ${JSON.stringify(TIER_SKU_PERCENTILE)}; style→tier = ${JSON.stringify(STYLE_TIER)}; style→flooring override = ${JSON.stringify(STYLE_FLOORING)} (default porcelain).`,
);
md.push(``);

md.push(`## 3. Quantity take-off (with derivations)`);
md.push(``);
md.push(`| ID | Section | Item | Qty | Unit | Derivation | QS correction |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const i of takeoff.items) {
  md.push(
    `| ${i.rule_id} | ${i.work_section} | ${i.description} | ${i.quantity} | ${i.unit} | ${i.measurement} | |`,
  );
}
md.push(``);

md.push(`## 4. Priced Bill of Quantities`);
md.push(``);
for (const s of boq.sections) {
  md.push(`### ${s.work_section} — ${aed(s.section_total_aed)}`);
  md.push(``);
  md.push(`| Item | Qty | Unit | Rate AED | Total AED | Source | Band | QS correction |`);
  md.push(`|---|---|---|---|---|---|---|---|`);
  for (const l of s.lines) {
    md.push(
      `| ${l.description} | ${l.quantity} | ${l.unit} | ${l.rate_aed.toLocaleString("en-US")} | ${l.total_aed.toLocaleString("en-US")} | ${l.vendor_or_source} | ${l.rate_band}${l.wastage_pct ? ` (+${l.wastage_pct}% wastage)` : ""} | |`,
    );
  }
  md.push(``);
}
md.push(`### Summary`);
md.push(``);
md.push(`| | AED |`);
md.push(`|---|---|`);
md.push(`| Subtotal | ${boq.subtotal_aed.toLocaleString("en-US")} |`);
md.push(`| Contingency ${CONTINGENCY_PCT}% | ${boq.contingency_aed.toLocaleString("en-US")} |`);
md.push(`| VAT ${VAT_PCT}% | ${boq.vat_aed.toLocaleString("en-US")} |`);
md.push(`| **Grand total** | **${boq.grand_total_aed.toLocaleString("en-US")}** |`);
md.push(``);

md.push(`## 5. Known gaps and allowances (flagged, not hidden)`);
md.push(``);
md.push(`- Individual bedroom/bathroom area splits are estimates within document-confirmed totals (bedrooms 61 m², bath floors ≈ 18 m², living 34 m²).`);
md.push(`- Allowance-rated items (no labour_rates row yet — QS to confirm): gypsum ceiling 125/m², LED cove 45/lm, terrace waterproofing 50/m², civil alterations 15,000 lump, staircase 6,000 lump, floor protection 8/m², scaffold 2,500, handover clean 1,500.`);
md.push(`- Engineered-wood supply is an allowance (no seeded SKU): ${RATE_RULES["floor.wood_material"]!.allowance_aed} AED/m².`);
md.push(`- Water heaters included 1/bathroom; Villa 94 retained existing units — confirm convention.`);
md.push(`- No bathtub line — preset assumes shower-only bathrooms (matches Villa 94).`);
md.push(`- Doors/wardrobes/vanities priced supply+install; in the real contract joinery is a separate client scope — a procurement flag (contractor vs client) is the planned v0.3 change.`);
md.push(`- Real-project calibration: tiling labour ≈120/m² blended and electrical ≈180/m² interior imply the CSV mid bands are low for premium jobs — rates are QS-review items, not engine constants.`);
md.push(``);

fs.writeFileSync(path.join(docsDir, "QS_REVIEW_PACK.md"), md.join("\n"));
console.log("  Wrote docs/boq-example.json and docs/QS_REVIEW_PACK.md\n");
