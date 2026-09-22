// =============================================================================
// lib/documents/pack-export/checks.ts — what the documents actually PRINT (T5).
//
// The assertions scripts/garden-draft-pack.ts ran on its own outputs, made
// generic so every pack — in-app or CLI, garden or interior — runs them. A check
// that only makes sense when something exists (a draft plan, a pergola
// elevation, overlays, passed renders) runs whenever that thing exists and is
// skipped otherwise; none is dropped. A failed check means NOTHING is released.
// Pure (server): no I/O.
// =============================================================================

import { assignRefs } from "@/lib/boq/refs";
import { boqDerivedInfo, derivedTotal, isUnpricedLine } from "@/lib/documents/boq-derived";
import type { ParityResult } from "@/lib/documents/parity";
import { findWithheldIdentities } from "@/lib/identity/curation";

import type { PackCheck, PackScope } from "./types";

type Line = Record<string, unknown> & { description?: string; rule_id?: string; rate_status?: string; rate_aed?: number; qty_derived?: boolean; notes?: string | null; vendor_or_source?: string; total_aed?: number };

export interface PrintedInput {
  scope: PackScope;
  /** The plan's draft statement when the plan is a draft on derived dimensions. */
  draftStatement: string | null;
  boq: { sections: { work_section: string; lines: Line[] }[]; grand_total_aed: number; garden?: { draft?: { draft?: boolean; statement?: string | null }; needs_selection?: string[] } | null; programme?: unknown };
  sheets: { sheetNumber: string; kind: string; title: string; svg: string }[];
  packPages: string[];
  packPageKinds: (string | undefined)[];
  /** null when the run produced no BoQ PDF (a reference pack: negotiated prices never leave). */
  boqPages: string[] | null;
  boqHtml: string;
  planHtml: string | null;
  parity: ParityResult | null;
  /** Identity strings from the ground-truth module (regex-escaped). */
  identityTokens: string[];
  /** Firm names withheld on this project's surfaces. */
  withheldNames: string[];
  publicSourceLabel: string;
  /** Present when the render step ran. */
  renders: {
    passedPlacement: { camera: string; placementChecked: boolean }[];
    inconsistentInPack: { camera: string; failures: string[] }[];
    checkedAgainstAnchor: number;
    anchor: string | null;
  } | null;
  pairsWithAdds: { outOfCrop: string[]; caption: string }[];
}

export function printedChecks(i: PrintedInput): PackCheck[] {
  const out: PackCheck[] = [];
  const check = (label: string, ok: boolean, detail = "") => out.push({ label, ok, detail });
  const garden = i.scope !== "interior";
  const lines = i.boq.sections.flatMap((s) => s.lines);
  const draft = i.draftStatement;

  // --- the BoQ --------------------------------------------------------------
  check("needs_selection is empty on the BoQ", lines.every((l) => l.rate_status !== "needs_selection") && (i.boq.garden?.needs_selection?.length ?? 0) === 0);
  if (draft) check("the BoQ knows it is a draft", i.boq.garden?.draft?.draft === true && i.boq.garden.draft.statement === draft);
  const derivedLines = lines.filter((l) => l.qty_derived === true);
  if (derivedLines.length) check("boundary-dependent quantities carry the derived flag and a note", derivedLines.every((l) => String(l.notes ?? "").length > 0), `${derivedLines.length} derived lines`);
  if (garden) {
    const priced = lines.filter((l) => /^GL-/.test(String(l.rule_id ?? "")) && l.rate_status !== "needs_qs" && Number(l.rate_aed) > 0);
    check("every priced landscape line carries the market-reference source label", priced.every((l) => l.vendor_or_source === i.publicSourceLabel), `${priced.length} priced lines`);
  }

  // --- the drawings ------------------------------------------------------------
  const kinds = i.sheets.map((s) => s.kind);
  check("the drawing set has sheets", i.sheets.length > 0, i.sheets.map((s) => s.sheetNumber).join(" "));
  if (garden) {
    check("drawings: cover, site plan, a sheet per zone, finish schedule", kinds[0] === "cover" && kinds.includes("site_plan") && kinds.includes("zone_plan") && kinds.includes("finish_schedule"));
    if (lines.some((l) => l.rule_id === "GL-14")) check("drawings: a sectional elevation for the designed structures", kinds.includes("structure_elevation"));
    if (lines.some((l) => /^GL-1[5-8]$|^GL-2[68]$/.test(String(l.rule_id)))) check("drawings: electrical + irrigation/drainage overlays", kinds.includes("lighting_overlay") && kinds.includes("irrigation_overlay"));
    const l201 = i.sheets.find((s) => s.sheetNumber === "L-201");
    if (l201) check("L-201 title block says ground (external works), not an interior level", l201.svg.includes("Level: Ground (external works)") && !/first floor/i.test(l201.svg));
    const pergola = i.sheets.find((s) => s.kind === "structure_elevation" && /pergola/i.test(s.title + s.svg.slice(0, 4000)));
    if (pergola) check("pergola elevation: posts on the graph and dimensioned", /Posts<\/text>[^]*?>\d+<\/text>/.test(pergola.svg) && (pergola.svg.match(/data-dim="pergola-post"/g) ?? []).length >= 2);
  } else {
    check("drawings: the as-built plan is in the set", kinds.includes("as_built"));
  }
  if (draft) {
    const stmt = `data-draft-statement="${draft}"`;
    check("watermark: every drawing sheet carries the draft stamp with the statement", i.sheets.every((s) => s.svg.includes('data-draft="true"') && s.svg.includes(stmt)), `${i.sheets.length} sheets`);
    if (garden) check("watermark: the drawing-set cover carries the statement", !!i.sheets[0]?.svg.includes("data-draft-cover") && i.sheets[0].svg.includes(stmt));
  }

  // --- the render pack (gardens) --------------------------------------------------
  if (garden) {
    check("the render pack has pages", i.packPages.length > 0, `${i.packPages.length} pages`);
    if (draft) {
      const stmt = `data-draft-statement="${draft}"`;
      check("watermark: the render-pack cover carries the statement", !!i.packPages[0]?.includes("data-draft-cover") && i.packPages[0].includes(stmt));
      check("the pack carries the Design assumptions page", i.packPages.some((s) => s.includes("Design assumptions") && s.includes("PROPOSAL")));
    }
    const packText = i.packPages.map((s) => s.replace(/<[^>]+>/g, " ")).join(" ");
    check("client-safe captions: no QA text in the pack", !/No render passed the checks|textured design model is shown|faithfulness gate found|gate unavailable/i.test(packText) && !/Evening view not rendered/.test(packText));
    const packFonts = i.packPages.flatMap((s, n) => (i.packPageKinds[n] === "plan_overview" ? [] : [...s.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]))));
    if (packFonts.length) check("legibility: no text in the render pack under 3.1 mm", packFonts.every((f) => f >= 3.1), `min ${Math.min(...packFonts)} mm`);
  }

  // --- the BoQ PDF -----------------------------------------------------------------
  const boqPages = i.boqPages ?? [];
  if (i.boqPages) {
    check("the BoQ PDF has pages", boqPages.length > 0, `${boqPages.length} pages`);
    if (draft) check("watermark: every BoQ PDF page header carries the statement", boqPages.every((p) => p.includes("data-boq-draft") && p.includes(draft)), `${boqPages.length} pages`);
    const total = derivedTotal(i.boq.grand_total_aed, boqDerivedInfo(i.boq as never));
    if (total.derived) check("the BoQ total renders with the derived convention, never a bare number", total.text.startsWith("≈ AED") && total.text.endsWith("*") && !!boqPages[0]?.includes(total.text), total.text);
    const boqFonts = boqPages.flatMap((s) => [...s.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])));
    if (boqFonts.length) check("legibility: no text in the BoQ PDF under 2.6 mm (A4)", boqFonts.every((f) => f >= 2.6), `min ${Math.min(...boqFonts)} mm`);
    if (i.boq.programme) check("the BoQ PDF carries the indicative delivery programme", boqPages.some((p) => p.includes("INDICATIVE DELIVERY PROGRAMME") && p.includes("data-programme-phase")));
    const unpriced = lines.filter(isUnpricedLine).length;
    if (unpriced) check("D4: the BoQ PDF headline says it excludes the lines still to be priced", boqPages.some((p) => p.includes('data-headline-excludes="true"')), `${unpriced} unpriced line(s)`);
    const refs = Object.values(assignRefs(i.boq.sections));
    const printedRefs = new Set(boqPages.flatMap((p) => [...p.matchAll(/data-ref="([^"]+)"/g)].map((m) => m[1]!)));
    check("D5: every BoQ line prints its unique REF", refs.length === printedRefs.size && refs.every((r) => printedRefs.has(r)), `${printedRefs.size}/${refs.length}`);
  }

  // --- the pages the client sees in the app --------------------------------------------
  if (draft) {
    check("BoQ page: draft header, derived total and derived line flags visible", i.boqHtml.includes("data-boq-draft") && i.boqHtml.includes("data-derived-total") && i.boqHtml.includes("data-derived-line"));
    if (i.planHtml !== null) check("plan page: the draft banner and derived markers are visible", i.planHtml.includes("Draft for review") && i.planHtml.includes("≈"));
  }

  // --- renders (gardens with a render step) -----------------------------------------
  if (i.renders) {
    const unplaced = i.renders.passedPlacement.filter((r) => !r.placementChecked);
    check("extended gate: every passed render checked built-feature placement against the scene", unplaced.length === 0, `${i.renders.passedPlacement.length} passed render(s)${unplaced.length ? `; unchecked: ${unplaced.map((r) => r.camera).join(", ")}` : ""}`);
    check(
      "no render that disagrees with the anchor view enters the pack (cross-view consistency)",
      i.renders.inconsistentInPack.length === 0,
      i.renders.inconsistentInPack.length ? i.renders.inconsistentInPack.map((b) => `${b.camera}: ${b.failures.join("; ")}`).join(" | ") : `${i.renders.checkedAgainstAnchor} views checked against ${i.renders.anchor ?? "no anchor"}`,
    );
  }
  if (i.pairsWithAdds.length) check("before/after: a built feature added in view is visible, or the caption says it is out of crop", i.pairsWithAdds.every((r) => r.outOfCrop.length === 0 || /Out of this photo's crop/.test(r.caption)), `${i.pairsWithAdds.length} pair(s)`);

  // --- parity -------------------------------------------------------------------
  if (i.parity) {
    if ((i.parity.overlays ?? []).length) check("parity counts overlay symbols against their lines", i.parity.overlays.every((o) => o.status === "ok"), i.parity.overlays.map((o) => `${o.type} ${o.symbols}/${o.line_qty ?? "—"}`).join(", "));
    const fails = [...i.parity.lines.filter((l) => l.status === "fail").map((l) => `${l.rule_id} ${l.reason}`), ...i.parity.elements.filter((e) => e.status === "fail").map((e) => `${e.name}: ${e.reason}`)];
    check("parity: every BoQ line is drawn and shown, every drawn cost is priced", i.parity.clean, fails.slice(0, 4).join("; "));
  }

  // --- identity and language, across everything printed -----------------------------
  const printed: [string, string][] = [
    ...i.sheets.map((s) => [`drawing ${s.sheetNumber}`, s.svg] as [string, string]),
    ...i.packPages.map((s, n) => [`pack page ${n + 1}`, s] as [string, string]),
    ...boqPages.map((s, n) => [`BoQ page ${n + 1}`, s] as [string, string]),
    ["BoQ data", JSON.stringify(i.boq)],
    ["BoQ page", i.boqHtml],
  ];
  const leaks = printed.flatMap(([where, text]) => [
    ...i.identityTokens.filter((t) => new RegExp(t, "i").test(text)).map((t) => `${where}: ${t}`),
    ...findWithheldIdentities(text, i.withheldNames).map((n) => `${where}: ${n}`),
  ]);
  check("zero contractor / supplier / firm identity across drawings, pack, BoQ PDF, BoQ data and BoQ page", leaks.length === 0, leaks.slice(0, 5).join("; ") || `${printed.length} documents scanned`);
  const internal = printed.filter(([where]) => where !== "BoQ data").flatMap(([where, text]) => (/\b(upsell|up-sell|margin|mark-?up|commission)\b/i.test(text.replace(/<[^>]+>/g, " ")) ? [where] : []));
  check("no internal sales or commercial language on any client-facing page", internal.length === 0, internal.slice(0, 5).join("; "));
  return out;
}
