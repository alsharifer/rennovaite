import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";

import { generateDeterministicBoq } from "../engine";
import { appendJoineryAluminumSections } from "../joinery-aluminum";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { appendOverlaySections } from "../../overlays/boq-feed";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

// =============================================================================
// H3 — PRICING DOES NOT DEPEND ON FEATURE FLAGS.
//
// For a fixed project state, no combination of feature flags may change any
// BoQ total. Flags decide what the UI shows; they never decide what a BoQ
// contains. (U7 fixed the six element sections; H3 fixed the P2 overlay feed,
// which silently dropped Electrical + Plumbing from every flag-off BoQ.)
//
// 1. PROOF, static: walk the runtime import graph of lib/boq/assemble.ts — the
//    one module the route, the scripts and this test price through — and
//    collect every process.env read. No feature flag may appear. If nothing in
//    the graph reads a flag, no combination of flags can move a total.
// 2. CONFIRMATION, dynamic: the pricing chain over a fixed Mudon state with
//    fixtures, under EVERY combination of the flags (2^n), gives one answer.
// =============================================================================

const ROOT = path.resolve(__dirname, "../../..");

/** Every feature flag the app reads (a new one is caught by the census below). */
const FEATURE_FLAGS = [
  "GARDEN_PILOT_ENABLED",
  "DRAWINGS_ENABLED",
  "OVERLAYS_ENABLED",
  "VIEWER_3D_ENABLED",
  "WHATIF_ENABLED",
  "PERMIT_CHECK_ENABLED",
  "STAGING_ENABLED",
  "TASTE_SEED_ENABLED",
  "TEXTURED_WALKTHROUGH",
  "PACK_EXPORT_ENABLED",
  "PROPERTY_OS_LANDING",
  "KG_ENABLED",
] as const;

const ENV_READ = /process\.env(?:\.([A-Z0-9_]+)|\[["']([A-Z0-9_]+)["']\])/g;
const envReads = (src: string) => [...src.matchAll(ENV_READ)].map((m) => (m[1] ?? m[2])!);

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package — outside the app's code
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Runtime imports only — `import type` / `export type` carry no code. */
function runtimeImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["'];?/gm)) if (!m[2]) out.push(m[3]!);
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["'];?/gm)) out.push(m[1]!);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of runtimeImports(readFileSync(f, "utf8"))) {
      const r = resolveImport(f, spec);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return seen;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

describe("H3 proof: nothing the BoQ is priced through reads a feature flag", () => {
  const graph = importGraph(path.join(ROOT, "lib/boq/assemble.ts"));
  const files = [...graph].map(rel);

  it("walks the real pricing path (not a vacuous graph)", () => {
    for (const f of ["lib/boq/engine.ts", "lib/overlays/boq-feed.ts", "lib/boq/garden-boq-feed.ts", "lib/boq/element-map.ts", "lib/boq/joinery-aluminum.ts", "lib/rates/firm.ts", "lib/plan/derive.ts"]) {
      expect(files, f).toContain(f);
    }
  });

  it("no module in the graph reads a feature flag", () => {
    const hits = [...graph].flatMap((f) => envReads(readFileSync(f, "utf8")).filter((n) => (FEATURE_FLAGS as readonly string[]).includes(n)).map((n) => `${rel(f)}: ${n}`));
    expect(hits).toEqual([]);
  });

  it("the route's only engine switch is BOQ_ENGINE, and KG grounding sits on the legacy LLM path alone", () => {
    const route = readFileSync(path.join(ROOT, "app/api/generate-boq/route.ts"), "utf8");
    expect(envReads(route).filter((n) => (FEATURE_FLAGS as readonly string[]).includes(n))).toEqual([]);
    expect(route).toMatch(/priceDeterministicBoq\(supabase, projectId, loaded\.inputs, \{ dryRun \}\)/);
    const legacy = route.indexOf("// 2b. LEGACY PATH");
    expect(legacy).toBeGreaterThan(0);
    expect(route.indexOf("await getKgContext(")).toBeGreaterThan(legacy);
    // ...and the deterministic path does not pull KG in through assemble.ts.
    expect(files).not.toContain("lib/kg/context.ts");
  });

  it("the flag list is complete: every *_ENABLED-style flag the app reads is in it", () => {
    const flagLike = /_ENABLED$|^PROPERTY_OS_LANDING$|^TEXTURED_WALKTHROUGH$/;
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) {
          if (n !== "node_modules" && n !== "__tests__") walk(p);
        } else if (/\.(ts|tsx)$/.test(n)) for (const e of envReads(readFileSync(p, "utf8"))) if (flagLike.test(e)) found.add(e);
      }
    };
    walk(path.join(ROOT, "app"));
    walk(path.join(ROOT, "lib"));
    walk(path.join(ROOT, "components"));
    expect([...found].filter((f) => !(FEATURE_FLAGS as readonly string[]).includes(f))).toEqual([]);
  });
});

describe("H3 confirmation: every combination of flags prices one fixed project the same", () => {
  const saved = Object.fromEntries(FEATURE_FLAGS.map((f) => [f, process.env[f]]));
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // Mudon's first floor with the fixtures its rules seed: a socket ring, lights,
  // an AC point per habitable room, and the wet-room points.
  const FIXTURES = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, type: "socket_13a" })),
    ...Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, type: "light_point" })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, type: "ac_point" })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `w${i}`, type: "wc_point" })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `b${i}`, type: "basin_point" })),
    { id: "sh0", type: "shower_mixer" },
  ];
  const fakeDb = { from: () => ({ select: () => ({ eq: async () => ({ data: FIXTURES, error: null }) }) }) } as unknown as SupabaseClient;

  async function price() {
    const { boq } = generateDeterministicBoq({
      rooms: MUDON_FIRST_FLOOR,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labourRates: LABOUR_RATES_FIXTURE as any,
      skus: PRICING_SKUS_FIXTURE,
      styleKey: "contemporary-arabic",
    });
    const overlaid = await appendOverlaySections(boq, "p0", fakeDb);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = appendJoineryAluminumSections(overlaid, MUDON_FIRST_FLOOR.map((r) => ({ ...r, name_en: r.name })) as any);
    return {
      grand: out.grand_total_aed,
      subtotal: out.subtotal_aed,
      sections: out.sections.map((s) => `${s.work_section}=${s.section_total_aed}`).join("|"),
    };
  }

  it(`all ${2 ** FEATURE_FLAGS.length} combinations → one BoQ, with Electrical + Plumbing priced`, async () => {
    const answers = new Map<string, number>();
    let reference: Awaited<ReturnType<typeof price>> | null = null;
    for (let mask = 0; mask < 2 ** FEATURE_FLAGS.length; mask++) {
      FEATURE_FLAGS.forEach((f, i) => {
        if (mask & (1 << i)) process.env[f] = "true";
        else delete process.env[f];
      });
      const r = await price();
      reference ??= r;
      const key = JSON.stringify(r);
      answers.set(key, (answers.get(key) ?? 0) + 1);
    }
    expect(answers.size).toBe(1);
    expect(reference!.sections).toMatch(/Electrical Installations=\d+/);
    expect(reference!.sections).toMatch(/Plumbing & Sanitary=\d+/);
  });
});
