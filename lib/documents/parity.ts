// =============================================================================
// lib/documents/parity.ts — BoQ ↔ drawings ↔ views parity (garden pilot G5c).
//
// A client reads three documents about one garden: the BoQ prices it, the
// drawings dimension it, the render pack shows it. The review found a BoQ line
// (the L-bench) that no view showed, and priced beds nobody could see. Parity is
// the rule that the three agree:
//
//   1. every BoQ line maps to an element that is VISIBLE on at least one drawing
//      sheet AND in at least one render/scene view of the pack;
//   2. every drawn element with a cost impact maps to at least one BoQ line.
//
// Pure: the loader (parity-load.ts) collects the sheet ids, the camera manifests
// and the photo-pair manifests; this module decides. A line with no element to
// point at (preliminaries) or an element priced elsewhere by rule (drainage
// points absorbed into the contract rate) is EXEMPT and says why — never silently
// skipped.
// =============================================================================

export interface ParityBoqLine {
  rule_id: string;
  description: string;
  quantity: number;
  unit: string;
  total_aed: number;
  element_refs?: string[];
}

export interface ParityElement {
  id: string;
  name: string;
  /** zone | run | fixture | opening | context */
  table: string;
  /** Zone token, run kind or fixture type. */
  kind: string;
  /** New work (costs), removed (demolition), kept (no cost), undecided. */
  status: "new" | "removed" | "kept" | "undecided";
}

export interface ParityInput {
  lines: ParityBoqLine[];
  elements: ParityElement[];
  /** Sheet number → element ids drawn on it (data-zone/run/fixture/opening/context). */
  sheets: { sheetNumber: string; ids: string[] }[];
  /** Pack view → element ids it shows (camera manifests). */
  views: { camera: string; label: string; ids: string[] }[];
  /** Existing items a passed before/after pair shows in its BEFORE photo (for demolition). */
  pairBeforeIds?: string[];
  /** G5d: overlay sheet numbers (L-401 lighting, L-402 irrigation & drainage) — their symbols are counted. */
  overlaySheets?: string[];
  /**
   * T5: the INTERIOR scope of the plan. Interior rooms are not priced per
   * element: the interior take-off prices them by area-driven rules (floor,
   * walls, ceiling across the rooms), and the P4 element lines name the rooms
   * they measured. So a room passes whenever the BoQ carries interior work, and
   * fails only when it is drawn and NO interior work is priced — genuinely
   * unpriced scope. Before T5 every interior room was checked against garden
   * (GL-) lines only, and every interior BoQ PDF was refused.
   */
  interior?: {
    rooms: { id: string; name: string; kind: string }[];
    /** Priced interior BoQ lines (any rule id that is not a GL- garden line). */
    lines: { rule_id: string; element_refs?: string[] | null; total_aed: number }[];
  };
}

/** G5d: one overlay symbol type, counted on the overlay sheets and in its BoQ line. */
export interface ParityOverlayRow {
  type: string;
  symbols: number;
  sheets: string[];
  rule_id: string | null;
  line_qty: number | null;
  status: "ok" | "fail";
  reason: string | null;
}

export interface ParityLineRow {
  rule_id: string;
  description: string;
  elements: number;
  sheets: string[];
  views: string[];
  status: "ok" | "exempt" | "fail";
  reason: string | null;
}

export interface ParityElementRow {
  id: string;
  name: string;
  kind: string;
  lines: string[];
  status: "ok" | "exempt" | "fail";
  reason: string | null;
}

export interface ParityResult {
  clean: boolean;
  lines: ParityLineRow[];
  elements: ParityElementRow[];
  /** G5d: overlay symbol counts against their BoQ lines. */
  overlays: ParityOverlayRow[];
}

/**
 * G5d: the overlay symbol types a BoQ line counts, and the line that counts them.
 * Garden lights are two lines (cabling + fitting) of the same quantity; the
 * cabling line stands for both.
 */
const OVERLAY_LINES: Record<string, string> = {
  garden_light: "GL-16",
  boundary_light: "GL-18",
  water_tap: "GL-26",
  drainage_point: "GL-28",
};

/** Lines that are the project, not an element. */
const PROJECT_LEVEL: Record<string, string> = {
  "GL-01": "project-level lump (preliminaries, approvals) — no drawn element",
  "GL-02": "project-level lump (mobilisation, site management) — no drawn element",
};

/**
 * Elements with a cost impact that the rate book prices inside another line.
 * G5d: none today — drainage points were here (absorbed at zero in the reference
 * contract) until L-402 drew two that no line counted; they are now a QS-to-price
 * line (GL-28), and the overlay count below holds every symbol type to its line.
 */
const ABSORBED: Record<string, string> = {};

/** Which elements a line stands for, when its element_refs do not say. */
function lineElements(line: ParityBoqLine, elements: readonly ParityElement[]): string[] {
  if (line.element_refs && line.element_refs.length) return line.element_refs;
  const newOf = (pred: (e: ParityElement) => boolean) => elements.filter((e) => e.status === "new" && pred(e)).map((e) => e.id);
  switch (line.rule_id) {
    case "GL-15": // irrigation allowance: what it waters
      return newOf((e) => (e.table === "zone" && e.kind === "planting_bed") || (e.table === "run" && e.kind === "planter_run"));
    case "GL-16":
    case "GL-17":
      return newOf((e) => e.table === "fixture" && e.kind === "garden_light");
    case "GL-18":
      return newOf((e) => e.table === "fixture" && e.kind === "boundary_light");
    case "GL-26":
      return newOf((e) => e.table === "fixture" && e.kind === "water_tap");
    case "GL-28":
      return newOf((e) => e.table === "fixture" && e.kind === "drainage_point");
    case "GL-03":
      return elements.filter((e) => e.status === "removed").map((e) => e.id);
    default:
      return [];
  }
}

export function buildParity(input: ParityInput): ParityResult {
  const sheetsOf = (id: string) => input.sheets.filter((s) => s.ids.includes(id)).map((s) => s.sheetNumber);
  const viewsOf = (id: string) => input.views.filter((v) => v.ids.includes(id)).map((v) => v.label);
  const lineMap = new Map<string, string[]>();

  const lines: ParityLineRow[] = input.lines.map((l) => {
    const project = PROJECT_LEVEL[l.rule_id];
    if (project) return { rule_id: l.rule_id, description: l.description, elements: 0, sheets: [], views: [], status: "exempt", reason: project };
    const ids = lineElements(l, input.elements);
    // Demolition on a plan with no existing item modelled (a completed garden, whose
    // strip-out predates the model) is a project-level lump, not a missing element.
    if (l.rule_id === "GL-03" && ids.length === 0) {
      lineMap.set(l.rule_id, []);
      return { rule_id: l.rule_id, description: l.description, elements: 0, sheets: [], views: [], status: "exempt", reason: "demolition of what stood before — no existing item is modelled on this plan; project-level lump" };
    }
    lineMap.set(l.rule_id, ids);
    const sheets = [...new Set(ids.flatMap(sheetsOf))].sort();
    let views = [...new Set(ids.flatMap(viewsOf))];
    // Demolition shows what is taken out: it is in the BEFORE photos, not in a design view.
    if (l.rule_id === "GL-03" && views.length === 0 && ids.some((id) => input.pairBeforeIds?.includes(id))) views = ["before photos (photo pairs)"];
    const reasons: string[] = [];
    if (ids.length === 0) reasons.push("no element on the plan stands for this line");
    else {
      if (sheets.length === 0) reasons.push("not visible on any drawing sheet");
      if (views.length === 0) reasons.push("not visible in any render or scene view");
    }
    return { rule_id: l.rule_id, description: l.description, elements: ids.length, sheets, views: views.sort(), status: reasons.length ? "fail" : "ok", reason: reasons.join("; ") || null };
  });

  const elements: ParityElementRow[] = input.elements
    .filter((e) => e.status === "new" || e.status === "removed")
    .map((e) => {
      const inLines = [...lineMap.entries()].filter(([, ids]) => ids.includes(e.id)).map(([rule]) => rule);
      const absorbed = e.table === "fixture" ? ABSORBED[e.kind] : undefined;
      if (inLines.length) return { id: e.id, name: e.name, kind: e.kind, lines: inLines, status: "ok", reason: null };
      if (absorbed) return { id: e.id, name: e.name, kind: e.kind, lines: [], status: "exempt", reason: absorbed };
      return { id: e.id, name: e.name, kind: e.kind, lines: [], status: "fail", reason: e.status === "removed" ? "taken out on the plan but not in the demolition line" : "drawn with a cost impact but no BoQ line prices it" };
    });

  elements.push(...interiorRows(input.interior));
  const overlays = overlayCounts(input);
  return { clean: lines.every((r) => r.status !== "fail") && elements.every((r) => r.status !== "fail") && overlays.every((r) => r.status !== "fail"), lines, elements, overlays };
}

/** T5: interior rooms against the interior take-off (see ParityInput.interior). */
export function interiorRows(interior: ParityInput["interior"]): ParityElementRow[] {
  if (!interior || interior.rooms.length === 0) return [];
  const priced = interior.lines.filter((l) => l.total_aed > 0);
  return interior.rooms.map((r) => {
    const naming = priced.filter((l) => (l.element_refs ?? []).includes(r.id)).map((l) => l.rule_id);
    if (naming.length) return { id: r.id, name: r.name, kind: r.kind, lines: [...new Set(naming)], status: "ok" as const, reason: null };
    if (priced.length) {
      return { id: r.id, name: r.name, kind: r.kind, lines: [], status: "exempt" as const, reason: `interior room — priced by the interior take-off's area-driven rules (${priced.length} interior line${priced.length === 1 ? "" : "s"}), not by element` };
    }
    return { id: r.id, name: r.name, kind: r.kind, lines: [], status: "fail" as const, reason: "interior room drawn, but the BoQ prices no interior work" };
  });
}

/**
 * G5d: every symbol type on the services overlays against the quantity of the
 * line that prices it. A symbol drawn and not counted (two drainage points on
 * L-402, none in the BoQ) or counted and not drawn fails. A line may carry fewer
 * points than are drawn only where it says so ("less N carried by the structure
 * rate" — a pergola's integral downlights).
 */
function overlayCounts(input: ParityInput): ParityOverlayRow[] {
  const overlay = new Set(input.overlaySheets ?? []);
  if (overlay.size === 0) return [];
  const drawn = input.sheets.filter((s) => overlay.has(s.sheetNumber));
  const byId = new Map(input.elements.filter((e) => e.table === "fixture" && e.status === "new").map((e) => [e.id, e]));
  const rows: ParityOverlayRow[] = [];
  for (const [type, rule] of Object.entries(OVERLAY_LINES)) {
    const ids = new Set<string>();
    const sheets = new Set<string>();
    for (const s of drawn) {
      for (const id of s.ids) {
        if (byId.get(id)?.kind !== type) continue;
        ids.add(id);
        sheets.add(s.sheetNumber);
      }
    }
    const line = input.lines.find((l) => l.rule_id === rule) ?? null;
    if (ids.size === 0 && !line) continue;
    const carried = Number(/less (\d+) carried by/.exec([line?.description, (line as { notes?: string | null; measurement?: string } | null)?.notes, (line as { measurement?: string } | null)?.measurement].filter(Boolean).join(" "))?.[1] ?? 0);
    const qty = line ? line.quantity + carried : null;
    const ok = qty === ids.size;
    rows.push({
      type,
      symbols: ids.size,
      sheets: [...sheets].sort(),
      rule_id: line?.rule_id ?? null,
      line_qty: line ? line.quantity : null,
      status: ok ? "ok" : "fail",
      reason: ok ? null : !line ? `${ids.size} drawn on ${[...sheets].join(" ")}, no BoQ line counts them` : `${ids.size} drawn, ${qty} in ${line.rule_id}`,
    });
  }
  return rows;
}

/** The ids a drawing sheet shows. */
export function sheetIds(svg: string): string[] {
  const out = new Set<string>();
  for (const m of svg.matchAll(/data-(?:zone|run|fixture|opening|context)="([^"]+)"/g)) out.add(m[1]!);
  return [...out];
}

/** The element ids a camera manifest shows ("zone:<id>", "run:<id>", "plants:<id>:0" …). */
export function manifestIds(keys: readonly string[]): string[] {
  return [...new Set(keys.map((k) => k.split(":")[1]).filter((x): x is string => !!x))];
}

/** A plain-text table for the pack report. */
export function parityTableText(p: ParityResult): string {
  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  const out = ["BoQ LINE → DRAWINGS / VIEWS"];
  for (const r of p.lines) out.push(`  ${pad(r.status.toUpperCase(), 7)} ${pad(r.rule_id, 7)} ${pad(r.description, 44)} ${pad(r.sheets.join(" ") || "—", 26)} ${pad(r.views.length ? `${r.views.length} view(s)` : "—", 12)} ${r.reason ?? ""}`);
  out.push("DRAWN ELEMENT → BoQ LINE");
  for (const r of p.elements) out.push(`  ${pad(r.status.toUpperCase(), 7)} ${pad(r.name, 48)} ${pad(r.kind, 16)} ${pad(r.lines.join(" ") || "—", 24)} ${r.reason ?? ""}`);
  out.push("OVERLAY SYMBOLS → BoQ QUANTITY");
  for (const r of p.overlays ?? []) out.push(`  ${pad(r.status.toUpperCase(), 7)} ${pad(r.type, 16)} ${pad(`${r.symbols} on ${r.sheets.join(" ") || "—"}`, 26)} ${pad(r.rule_id ? `${r.rule_id} × ${r.line_qty}` : "no line", 16)} ${r.reason ?? ""}`);
  out.push(`PARITY ${p.clean ? "CLEAN" : "NOT CLEAN"}`);
  return out.join("\n");
}
