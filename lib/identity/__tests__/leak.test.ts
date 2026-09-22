import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildGardenSections } from "@/lib/boq/garden-boq-feed";
import { gardenBookFromRows, transcriptionGardenRows } from "@/lib/boq/garden-rates";
import { VILLA94_GARDEN } from "@/lib/ground-truth/villa94-garden-plan";
import { INTERNAL_REF } from "@/lib/ground-truth/villa94-garden";
import { fakeDb } from "@/lib/firms/__tests__/fake-db";
import { buildBoqProvenance, type ProvBoq } from "@/lib/provenance/boq";
import { loadProvenanceContext } from "@/lib/provenance/load";
import { loadReferenceRows, type ReferenceRateRow } from "@/lib/rates/reference";
import { recalc } from "@/lib/whatif/engine";
import { loadRateBook } from "@/lib/whatif/rate-book";

import { curateBoq, findWithheldIdentities } from "../curation";

// =============================================================================
// I4 IDENTITY-LEAK ASSERTION.
//
// A SEEDED name fixture — names that exist nowhere in the codebase — is written
// into every place a contractor identity can live (rate_book.source,
// rate_book.internal_ref, firms.name, a zone's derived_note, stored BoQ text).
// Then every UI payload is built from that state and searched for the seeds:
//   - the popover payload (buildBoqProvenance over the curated BoQ)
//   - the BoQ document as sent to the page / PDF / API (curateBoq)
//   - the what-if rate book (a page prop) and its recalc output (perChange)
//   - the reference rows a pricing path reads
// Plus the real withheld identities (Atrium, Global Creation, KAME, …) on a
// document stored before the I4 source scrub.
// =============================================================================

const SEED = {
  source: "Seedwell Contracting LLC quotation SQ-77341",
  internal: "Oakhurst Fitout Partners — agreement OFP-2291",
  firm: "Brambleton Landscapes",
};
const SEEDED = [SEED.source, "Seedwell", "SQ-77341", SEED.internal, "Oakhurst", "OFP-2291", SEED.firm, "Brambleton"];

const noSeeds = (payload: unknown, where: string) => {
  const text = JSON.stringify(payload);
  for (const s of SEEDED) expect(text, `${where} leaks "${s}"`).not.toContain(s);
};

const seededDb = () =>
  fakeDb({
    rate_book: [
      ...transcriptionGardenRows().map((r) => ({ ...r, city: "Dubai", qs_validated: false, source: SEED.source, internal_ref: SEED.internal })),
      { city: "Dubai", item_key: "floor_finish", grade: "premium", unit: "m2", rate_aed: 480, scope: null, provenance: "actual_transaction", valid_from: "2026-09-20", work_section: "Floor Finishes", qs_validated: false, source: SEED.source, internal_ref: SEED.internal },
    ],
    firms: [{ id: "f1", name: SEED.firm, private: true }],
    plans: [{ id: "plan1", project_id: "p1", created_at: "2026-09-20" }],
    rooms: [{ id: "z1", plan_id: "plan1", name_en: "Rear lawn", room_type: "artificial_grass", dims_derived: true, derived_note: `sized to measured aggregate (${SEED.firm} site measurement)` }],
    plan_elements: [],
    plan_fixtures: [],
    plan_context: [],
  });

describe("identity-leak assertion — seeded name fixture", () => {
  it("what-if: the rate book passed to the page and its recalc output carry no source name", async () => {
    const db = seededDb();
    const rb = await loadRateBook(db.client);
    noSeeds(rb, "loadRateBook");
    expect(rb.floor_finish.premium.rate_aed).toBe(480); // the seeded row DID load
    expect(rb.floor_finish.premium.source).toBe("transacted market reference (rate book)");
    const r = recalc(
      { grand_total_aed: 1000, sections: [{ work_section: "Floor Finishes", lines: [{ rule_id: "P4/quantify/floor_finish", quantity: 10, rate_aed: 190, total_aed: 1900, description: "Floor" }] }] },
      rb,
      { floor_finish: "premium" },
    );
    noSeeds(r, "what-if recalc");
  });

  it("pricing reads: reference rows carry no source / internal_ref", async () => {
    const rows = await loadReferenceRows(seededDb().client);
    expect(rows.length).toBeGreaterThan(0);
    noSeeds(rows, "loadReferenceRows");
  });

  it("popover payload + BoQ document: priced from seeded rows, with a firm name in a zone note", async () => {
    const db = seededDb();
    const leakyRows = (await db.client.from("rate_book").select("*")) as unknown as { data: ReferenceRateRow[] };
    const built = buildGardenSections(VILLA94_GARDEN, gardenBookFromRows(leakyRows.data));
    const doc: ProvBoq = {
      sections: [
        ...(built.sections as unknown as ProvBoq["sections"]),
        // A stored line that carries the firm's name in its text (as a pre-I4 BoQ might).
        { work_section: "Soft Landscaping", section_total_aed: 0, lines: [{ description: `Lawn (${SEED.firm} measure)`, quantity: 1, unit: "m2", rate_aed: 0, total_aed: 0, vendor_or_source: SEED.firm, notes: "", rule_id: "GL-07", element_refs: ["z1"] }] },
      ],
      subtotal_aed: 0, contingency_pct: 8, contingency_aed: 0, vat_pct: 5, vat_aed: 0, grand_total_aed: 0,
    };
    const ctx = await loadProvenanceContext(db.client, "p1");
    expect(ctx.withheldNames).toContain(SEED.firm);
    const curated = curateBoq(doc, ctx.withheldNames);
    noSeeds(curated, "curated BoQ document");
    const prov = buildBoqProvenance(doc, ctx); // built from the UNcurated doc: the builder curates too
    noSeeds(prov, "popover payload");
    expect(JSON.stringify(prov)).toContain("sized to measured aggregate");
  });

  it("the real withheld identities never survive curation (a BoQ stored before the I4 source scrub)", () => {
    const legacy = {
      sections: [
        {
          work_section: "Joinery",
          section_total_aed: 0,
          lines: [
            { description: "Fitted bedroom cabinet", quantity: 1, unit: "m2", rate_aed: 850, total_aed: 850, vendor_or_source: "Atrium Technical Services QTN20261407 (actual composite rates)", notes: "Heuristic: 7 m² per bedroom × 2 (Atrium 2.1/3.1)", rule_id: "GT/joinery/cabinet" },
            { description: "Skylight", quantity: 1, unit: "no", rate_aed: 9000, total_aed: 9000, vendor_or_source: "Global Creation Services ref 3936/R1 (allowance)", notes: "S6-pre G21 — excluded from the Global Creation package", rule_id: "GT/aluminum/skylight" },
            { description: "Pergola", quantity: 1, unit: "m2 plan", rate_aed: 1, total_aed: 1, vendor_or_source: INTERNAL_REF, notes: "KAME Landscape & Pools", rule_id: "GL-14" },
          ],
        },
      ],
      subtotal_aed: 0, contingency_pct: 8, contingency_aed: 0, vat_pct: 5, vat_aed: 0, grand_total_aed: 0,
    };
    expect(findWithheldIdentities(legacy).length).toBeGreaterThan(3);
    expect(findWithheldIdentities(curateBoq(legacy))).toEqual([]);
    expect(findWithheldIdentities(buildBoqProvenance(legacy as ProvBoq))).toEqual([]);
  });

  it("the Mudon golden (post-scrub source) carries no withheld identity at all", () => {
    const golden = fs.readFileSync(path.join(__dirname, "../../boq/__tests__/__snapshots__/mudon-boq.golden.json"), "utf8");
    expect(findWithheldIdentities(golden)).toEqual([]);
  });
});

describe("the withheld strings cannot reach a client bundle", () => {
  // lib/identity/curation.ts and lib/ground-truth/* HOLD the names they withhold
  // (INTERNAL_REF, the patterns). A client component that imported them — even
  // transitively — would ship those names to every browser.
  const ROOT = path.resolve(__dirname, "../../..");
  const FORBIDDEN = [/lib[\\/]identity[\\/]curation/, /lib[\\/]ground-truth[\\/]/];

  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const p = base + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return null;
  };

  const importsOf = (file: string): string[] => {
    const src = fs.readFileSync(file, "utf8");
    const out: string[] = [];
    for (const m of src.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g)) {
      if (m[2]) continue; // type-only imports are erased
      const r = resolve(file, m[3]!);
      if (r) out.push(r);
    }
    return out;
  };

  const clientFiles = (dir: string, acc: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "__tests__") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) clientFiles(p, acc);
      else if (/\.tsx?$/.test(e.name) && /^\s*["']use client["']/.test(fs.readFileSync(p, "utf8"))) acc.push(p);
    }
    return acc;
  };

  it("no \"use client\" module imports curation or ground-truth, directly or transitively", () => {
    const offenders: string[] = [];
    for (const entry of [...clientFiles(path.join(ROOT, "app")), ...clientFiles(path.join(ROOT, "components"))]) {
      const seen = new Set<string>();
      const stack: { file: string; via: string[] }[] = [{ file: entry, via: [] }];
      while (stack.length) {
        const { file, via } = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        if (FORBIDDEN.some((re) => re.test(file))) {
          offenders.push([entry, ...via, file].map((f) => path.relative(ROOT, f)).join(" → "));
          continue;
        }
        for (const next of importsOf(file)) stack.push({ file: next, via: [...via, file] });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("T3b — rulings applied and the own-firm rule", () => {
  it("a firm's name is withheld on every project but its own (generic, not per-firm)", async () => {
    const { withheldFirmNames, loadWithheldNames } = await import("../curation");
    const firms = [{ id: "fa", name: "Alpha Landscapes" }, { id: "fb", name: "Beta Fitout" }];
    expect(withheldFirmNames(firms, "fa")).toEqual(["Beta Fitout"]);
    expect(withheldFirmNames(firms, null)).toEqual(["Alpha Landscapes", "Beta Fitout"]);
    const db = fakeDb({ firms, projects: [{ id: "pa", firm_id: "fa" }, { id: "p0", firm_id: null }] });
    expect(await loadWithheldNames(db.client, "pa")).toEqual(["Beta Fitout"]);
    expect(await loadWithheldNames(db.client, "p0")).toEqual(["Alpha Landscapes", "Beta Fitout"]);
    // Own project: the note keeps the firm's name. Anyone else's: withheld.
    const note = "sized to measured aggregate (Alpha Landscapes site measurement)";
    expect(curateBoq(note, await loadWithheldNames(db.client, "pa"))).toContain("Alpha Landscapes");
    expect(curateBoq(note, await loadWithheldNames(db.client, "p0"))).not.toContain("Alpha Landscapes");
  });

  it("the ruled names never survive curation — Laspinas, Villa 94, the RAK tiles quotation", () => {
    const stored = [
      "R-40: GROHE shattaf, matt black — Laspinas 46703 line 1025302431 (supply); 1 per wet room × 3 (Laspinas)",
      "Laspinas quotation 46703, 13 Jun 2026 (Mudon Villa 94)",
      "R-30: … (Villa 94: AED 21k ÷ 130 m² + 120 lm cove)",
      "SOW AlNaseem F2 V94 (ref SOW-R02)",
      "S6-pre G19 — excluded from the RAK tiles quotation; indicative allowance",
    ];
    const out = curateBoq(stored);
    expect(findWithheldIdentities(stored).length).toBeGreaterThan(0);
    expect(findWithheldIdentities(out)).toEqual([]);
    expect(out[0]).toBe("R-40: GROHE shattaf, matt black — sanitaryware supplier (supply); 1 per wet room × 3 (sanitaryware supplier)");
    expect(out[4]).toContain("the client-supplied tile package");
    // RAK as a catalogue brand is a specification and stays.
    expect(curateBoq("RAK Ceramics — RAK-MRB-MAXIMUSC-60X60")).toBe("RAK Ceramics — RAK-MRB-MAXIMUSC-60X60");
  });

  it("no BoQ-emitting module still prints a ruled name", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const files = ["lib/boq/rules.ts", "lib/boq/takeoff.ts", "lib/boq/joinery-aluminum.ts", "lib/accessories/seed-data.ts", "lib/whatif/grades.ts", "lib/timeline/estimate.ts"];
    for (const f of files) {
      // Strings only: comments may cite the reference for engineers.
      const code = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      const strings = code.match(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
      expect({ f, hits: findWithheldIdentities(strings.join("\n")) }).toEqual({ f, hits: [] });
    }
  });
});
