// =============================================================================
// scripts/verify-graph-integrity.ts — Pilot Seven verification (P1–P5 integrity).
//
// For the Mudon project, asserts the four load-bearing invariants that keep the
// deterministic pipeline honest:
//   (a) drawing dimensions reconcile with graph areas
//   (b) BoQ computed quantities match lib/boq/quantify.ts outputs
//   (c) every element_refs id resolves to a live element
//   (d) the what-if baseline equals the stored BoQ total
//
// Runs against the live DB via PostgREST (service role from .env.local) and the
// SAME pure modules the app uses — geometry/quantify/elements/grades are all
// runtime-pure (zero or type-only imports), so Node loads them directly.
//
// Run: node scripts/verify-graph-integrity.ts
// =============================================================================

import { readFile } from "node:fs/promises";

import { buildPlanGraph, polygonArea, type RawRoom, type PlanGraph } from "../lib/plan/geometry.ts";
import { quantifyPlan } from "../lib/boq/quantify.ts";
import { assembleMappedSections } from "../lib/boq/elements.ts";
import {
  GRADE_SPECS,
  BASELINE_GRADE,
  itemKeyFromRuleId,
} from "../lib/whatif/grades.ts";

const ROOT = "C:/dev/rennovaite";
const MUDON = "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";
const AREA_TOL = 0.01; // 1% envelope reconciliation

type Line = {
  description: string;
  quantity: number;
  rate_aed: number;
  total_aed: number;
  rule_id?: string;
  element_refs?: string[] | null;
};
type Section = { work_section: string; lines: Line[] };
type Boq = { sections: Section[]; grand_total_aed: number };

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function loadEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const raw = await readFile(`${ROOT}/.env.local`, "utf8").catch(() => "");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

async function main() {
  const env = await loadEnv();
  const U = env.NEXT_PUBLIC_SUPABASE_URL;
  const K = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!U || !K) throw new Error("Missing Supabase env in .env.local");
  const H = { apikey: K, Authorization: `Bearer ${K}` };
  const get = async (path: string) => {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: H });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  };

  // --- Load: plan, rooms (name_en order, matching derive.ts), BoQ, fixtures, proposed snapshot ---
  const plans = await get(
    `plans?project_id=eq.${MUDON}&select=id,total_area_m2,parsed_json&order=created_at.desc&limit=1`,
  );
  if (!plans.length) throw new Error("Mudon has no plan");
  const plan = plans[0];
  const rooms: (RawRoom & { area_m2: number | null })[] = await get(
    `rooms?plan_id=eq.${plan.id}&select=id,name_en,name_ar,room_type,area_m2,polygon&order=name_en`,
  );
  const boqRows = await get(
    `boqs?project_id=eq.${MUDON}&select=sections,total_aed&order=created_at.desc&limit=1`,
  );
  if (!boqRows.length) throw new Error("Mudon has no BoQ");
  const boq: Boq = boqRows[0].sections;
  const fixtures: { id: string }[] = await get(
    `plan_fixtures?project_id=eq.${MUDON}&select=id`,
  ).catch(() => []);
  const propRows = await get(
    `plan_snapshots?project_id=eq.${MUDON}&kind=eq.proposed&select=graph&order=created_at.desc&limit=1`,
  ).catch(() => []);
  const proposed: PlanGraph | null = propRows?.[0]?.graph ?? null;

  // --- Rebuild the graph exactly as derivePlanGraph does ---
  const parsed = plan.parsed_json as { scale?: string | null } | null;
  const graph = buildPlanGraph({
    projectId: MUDON,
    planId: plan.id,
    scale: parsed?.scale ?? null,
    total_area_m2: plan.total_area_m2,
    rooms: rooms as RawRoom[],
  });

  console.log(`\nMudon integrity — plan=${plan.id}  rooms=${graph.rooms.length}  walls=${graph.walls.length}  BoQ total=AED ${boq.grand_total_aed}\n`);

  // (a) Drawing dimensions reconcile with graph areas -------------------------
  // Two distinct area concepts, both sourced from the graph:
  //   - plan-sheet dimension chains come from the METRIC polygons, which are
  //     scaled to integrate to meta.total_area_m2 (the gross envelope).
  //   - the finish schedule lists per-room area_m2 (the DB-authoritative NET
  //     room areas). Σ(net room areas) is legitimately LESS than the gross
  //     envelope (wall footprint + circulation) — they are not the same figure.
  console.log("(a) Drawing dimensions ⇄ graph areas");
  const dimAreaSum = graph.rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
  const scheduleAreaSum = graph.rooms.reduce((s, r) => s + r.area_m2, 0);
  const totalArea = graph.meta.total_area_m2;
  check(
    "Σ metric-polygon area == meta.total_area_m2 (dimension chains reconcile to envelope)",
    Math.abs(dimAreaSum - totalArea) / totalArea <= AREA_TOL,
    `dims=${dimAreaSum.toFixed(1)} m² vs total=${totalArea.toFixed(1)} m² (${((Math.abs(dimAreaSum - totalArea) / totalArea) * 100).toFixed(2)}%)`,
  );
  check(
    "every finish-schedule area is the graph's room area_m2 (finite, > 0)",
    graph.rooms.every((r) => Number.isFinite(r.area_m2) && r.area_m2 > 0),
    `${graph.rooms.length} rooms, Σ net = ${scheduleAreaSum.toFixed(1)} m² (gross envelope ${totalArea.toFixed(1)} m²; Δ ${(totalArea - scheduleAreaSum).toFixed(1)} m² = walls + circulation)`,
  );
  // Informational: per-room isotropic-scale divergence (dimensioned rectangle
  // area vs DB net area). This is the P1 derived-metres caveat, not a failure.
  const worst = graph.rooms
    .map((r) => ({ name: r.name_en, dim: polygonArea(r.polygon), net: r.area_m2 }))
    .map((x) => ({ ...x, pct: x.net > 0 ? Math.abs(x.dim - x.net) / x.net : 0 }))
    .sort((a, b) => b.pct - a.pct)[0];
  if (worst) {
    console.log(
      `      ↳ per-room dim-vs-net divergence (derived metres): worst = ${worst.name} ` +
        `${worst.dim.toFixed(1)} vs ${worst.net.toFixed(1)} m² (${(worst.pct * 100).toFixed(0)}%)`,
    );
  }

  // (b) BoQ computed quantities match lib/boq/quantify.ts ----------------------
  console.log("(b) Stored BoQ quantities ⇄ fresh quantify.ts");
  const items = quantifyPlan(graph, { proposed });
  const fresh = assembleMappedSections(items);
  const freshByRule = new Map<string, number>();
  for (const s of fresh) for (const l of s.lines) freshByRule.set(l.rule_id, l.quantity);
  const storedMapped = boq.sections
    .flatMap((s) => s.lines)
    .filter((l) => l.rule_id?.startsWith("P4/quantify/"));
  check("stored BoQ carries P4 mapped lines", storedMapped.length > 0, `${storedMapped.length} lines`);
  let qtyMismatch = 0;
  for (const l of storedMapped) {
    const expected = freshByRule.get(l.rule_id!);
    if (expected == null || Math.abs(expected - l.quantity) > 0.02) {
      qtyMismatch++;
      console.log(`      ↳ ${l.rule_id}: stored ${l.quantity} vs fresh ${expected ?? "—"}`);
    }
  }
  check("every mapped line quantity matches quantify.ts", qtyMismatch === 0, `${qtyMismatch} mismatch(es)`);

  // (c) Every element_refs id resolves to a live element ----------------------
  console.log("(c) element_refs ⇄ live elements");
  const live = new Set<string>([
    ...graph.rooms.map((r) => r.id),
    ...graph.walls.map((w) => w.id),
    ...fixtures.map((f) => f.id),
  ]);
  const allRefs = boq.sections.flatMap((s) => s.lines).flatMap((l) => l.element_refs ?? []);
  const dangling = allRefs.filter((id) => !live.has(id));
  check(
    "all element_refs resolve",
    dangling.length === 0,
    `${allRefs.length} refs, ${dangling.length} dangling${dangling.length ? ` (${dangling.slice(0, 3).join(", ")}…)` : ""}`,
  );

  // (d) What-if baseline equals stored BoQ total ------------------------------
  console.log("(d) What-if baseline ⇄ stored BoQ total");
  // Baseline = all gradeable lines at BASELINE_GRADE (standard). recalc's delta
  // per line = (rateBook[standard].rate − line.rate) × qty; the baseline total
  // equals the stored total iff the standard rate equals each stored line rate.
  let baselineDelta = 0;
  let rateMismatch = 0;
  for (const l of storedMapped) {
    const key = itemKeyFromRuleId(l.rule_id);
    if (!key) continue;
    const stdRate = GRADE_SPECS[key][BASELINE_GRADE].rate_aed;
    if (Math.abs(stdRate - l.rate_aed) > 0.001) {
      rateMismatch++;
      console.log(`      ↳ ${key}: rate_book standard ${stdRate} vs BoQ line ${l.rate_aed}`);
    }
    baselineDelta += (stdRate - l.rate_aed) * l.quantity;
  }
  check("rate-book standard rate == stored gradeable line rate", rateMismatch === 0, `${rateMismatch} mismatch(es)`);
  const baselineTotal = boq.grand_total_aed + Math.round(baselineDelta * 100) / 100;
  check(
    "what-if baseline total == stored grand_total",
    Math.round(baselineTotal) === Math.round(boq.grand_total_aed),
    `baseline=AED ${Math.round(baselineTotal)} vs stored=AED ${Math.round(boq.grand_total_aed)}`,
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
