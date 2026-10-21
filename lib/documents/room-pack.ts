// =============================================================================
// lib/documents/room-pack.ts — one room's client pack, page by page (bathroom
// pilot B6; the E1-lite render pack's shape, for an interior room). Pure.
//
//   cover          brand, project, room, the anchor view, the total
//   room plan      the room with its fixtures and every photo placed on it (P1…)
//   views          one page per view: the render beside the photo it came from,
//                  its origin ("from your photo" / "concept") and its checks
//   drawings       the room's sheets as drawn (R-101 plan, R-201… elevations) —
//                  the pages ARE the sheets, so a dimension in the pack is the
//                  dimension on the drawing
//   materials      the room design spec read from the locked view
//   BoQ            by section, every line; to-be-priced lines named
//   price          the chain to the fil and the options, outside the total
//   programme      the room's own programme from its quantities
//                  (lib/timeline/programme.ts, C4: THE programme) — dropped when it cannot
//
// Photographs are image SLOTS the PDF step fills (`src` = the image URL); the
// page chrome is SVG. No rate, source, tier, supplier or contractor reaches a
// page: the client reads quantities, amounts and the basis in words only.
// =============================================================================

import { esc } from "@/lib/drawings/sheet";
import { allowanceShare } from "@/lib/boq/allowance-share";
import { formatAed } from "@/lib/format/aed";

import { DOC, hline, label, text, wrapWords } from "./doc-style";

export const PACK_W = 420;
export const PACK_H = 297;
const M = 16;
const R = PACK_W - M;
const aed = (n: number) => formatAed(n, "money");

export interface PackSlot {
  /** The image's URL — fetched and embedded by the PDF step. */
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomPackPage {
  kind: "cover" | "room_plan" | "view" | "drawing" | "materials" | "boq" | "price" | "programme";
  title: string;
  svg: string;
  images: PackSlot[];
}

export interface RoomPackView {
  n: number;
  label: string;
  origin: "from your photo" | "concept";
  /** The render shown (the locked version, else the latest that passed) — null when none matches the current design. */
  render: { src: string; version: number } | null;
  /** B7: why no render is shown — "View pending — design changed in rev N" (render-consistency.ts). */
  pending?: string | null;
  photo: { src: string } | null;
  checks: { text: string; ok: boolean }[];
  locked: boolean;
  anchor: boolean;
  camera: { position: [number, number]; heading_deg: number } | null;
}

export interface RoomPackLine {
  /** B5: what the rate rests on — calibrated | market | allowance | tbc | firm. */
  rate_basis?: string;
  description: string;
  quantity: number;
  unit: string;
  total_aed: number;
  rate_status?: string;
  rate_aed?: number;
  stated_zero?: boolean;
}

export interface RoomPackInput {
  brand: string;
  projectName: string;
  community: string;
  dateISO: string;
  rev: string;
  room: { name: string; area_m2: number; ceiling_mm: number; tiled: string; polygon: [number, number][]; mPerU: number };
  fixtures: { type: string; corners: [number, number][] }[];
  openings: { kind: string; a: [number, number]; b: [number, number] }[];
  views: RoomPackView[];
  anchorLabel: string | null;
  sheets: { number: string; title: string; svg: string }[];
  spec: { element: string; finish: string }[] | null;
  boq: {
    sections: { work_section: string; lines: RoomPackLine[]; section_total_aed: number }[];
    subtotal_aed: number;
    ohp_aed?: number;
    ohp_pct?: number;
    contingency_pct: number;
    contingency_aed: number;
    vat_pct: number;
    vat_aed: number;
    grand_total_aed: number;
    options?: { key: string; label: string; note: string; net_aed: number; delta_total_aed?: number }[];
  };
  /** B7 / C4: THE programme (lib/timeline/programme.ts programmeOf) — null drops the page. */
  programme: { total_days: number; low_days: number; high_days: number; phases: { label: string; start_day: number; days: number; basis?: string }[]; basis: string } | null;
}

const unpriced = (l: RoomPackLine) => l.rate_status === "needs_qs" && (l.rate_aed ?? 0) === 0;

function frame(input: RoomPackInput, title: string, n: number): string {
  let s = `<rect x="0" y="0" width="${PACK_W}" height="${PACK_H}" fill="#FFFFFF"/>`;
  s += text(M, 12, `${input.brand} · ${input.projectName} · ${input.room.name}`, { size: 3, fill: DOC.INK_2, font: DOC.MONO });
  s += text(R, 12, `rev ${input.rev} · ${input.dateISO}`, { size: 3, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
  s += hline(M, R, 16);
  s += text(M, 28, title, { size: 8, font: DOC.SERIF });
  s += hline(M, R, PACK_H - 14);
  s += text(M, PACK_H - 8, "For review — not for construction. Every figure reconciles to the bill of quantities.", { size: 2.8, fill: DOC.INK_2, font: DOC.MONO });
  s += text(R, PACK_H - 8, `Page ${n}`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
  return s;
}

const wrapSvg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${PACK_W}mm" height="${PACK_H}mm" viewBox="0 0 ${PACK_W} ${PACK_H}">${body}</svg>`;

const FIXTURE_NAME: Record<string, string> = { wc_point: "WC", bidet_point: "Bidet", basin_point: "Vanity", shower_mixer: "Shower", bath_point: "Bath", storage_cabinet: "Cabinet" };

/** The room in a box, with fixtures, openings and the photo markers. */
function roomPlanSvg(input: RoomPackInput, x: number, y: number, w: number, h: number): string {
  const poly = input.room.polygon;
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), sx = Math.max(...xs) - minX, sy = Math.max(...ys) - minY;
  const k = Math.min(w / sx, h / sy);
  const P = (p: [number, number]) => [x + (p[0] - minX) * k, y + (p[1] - minY) * k] as const;
  const pts = (ps: readonly [number, number][]) => ps.map((p) => P(p).map((v) => v.toFixed(2)).join(",")).join(" ");
  let s = `<polygon points="${pts(poly)}" fill="#F7F5EF" stroke="${DOC.INK}" stroke-width="1.2"/>`;
  for (const f of input.fixtures) {
    if (!f.corners.length) continue;
    s += `<polygon points="${pts(f.corners)}" fill="none" stroke="${DOC.INK_3}" stroke-width="0.4"/>`;
    const c = P([f.corners.reduce((a, p) => a + p[0], 0) / f.corners.length, f.corners.reduce((a, p) => a + p[1], 0) / f.corners.length]);
    const name = FIXTURE_NAME[f.type];
    // At the top of its footprint, clear of a photo marker at its centre.
    const top = Math.min(...f.corners.map((p) => P(p)[1]));
    if (name) s += text(c[0], top + 4.5, name, { size: 2.6, fill: DOC.INK_2, anchor: "middle" });
  }
  for (const o of input.openings) {
    const [a, b] = [P(o.a), P(o.b)];
    s += `<line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="#FFFFFF" stroke-width="1.6"/><line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="${DOC.INK}" stroke-width="0.4" stroke-dasharray="${o.kind === "window" ? "1 0.6" : "0"}"/>`;
  }
  for (const v of input.views) {
    if (!v.camera) continue;
    const [cx, cy] = P(v.camera.position);
    const th = (v.camera.heading_deg * Math.PI) / 180;
    const [tx, ty] = [cx + Math.sin(th) * 14, cy - Math.cos(th) * 14];
    s += `<line x1="${cx.toFixed(2)}" y1="${cy.toFixed(2)}" x2="${tx.toFixed(2)}" y2="${ty.toFixed(2)}" stroke="${DOC.INK}" stroke-width="0.6"/>`;
    s += `<rect x="${(cx - 5).toFixed(2)}" y="${(cy - 3.6).toFixed(2)}" width="10" height="7.2" fill="${v.anchor ? DOC.INK : "#FFFFFF"}" stroke="${DOC.INK}" stroke-width="0.4" data-photo-marker="P${v.n}"/>`;
    s += text(cx, cy + 1.2, `P${v.n}`, { size: 3.2, font: DOC.MONO, anchor: "middle", fill: v.anchor ? "#FFFFFF" : DOC.INK, weight: 600 });
  }
  return s;
}

export function buildRoomPack(input: RoomPackInput): RoomPackPage[] {
  const pages: RoomPackPage[] = [];
  const push = (kind: RoomPackPage["kind"], title: string, body: string, images: PackSlot[] = []) => pages.push({ kind, title, svg: wrapSvg(body), images });
  const unpricedLines = input.boq.sections.flatMap((s) => s.lines.filter(unpriced));
  const excludes = unpricedLines.length ? `excludes ${unpricedLines.length} ${unpricedLines.length === 1 ? "line" : "lines"} to be priced` : null;

  // --- cover -----------------------------------------------------------------------------
  {
    let s = `<rect x="0" y="0" width="${PACK_W}" height="${PACK_H}" fill="#FFFFFF"/>`;
    s += text(M, 22, input.brand, { size: 4, font: DOC.MONO, fill: DOC.INK_2 });
    s += text(M, 52, input.room.name, { size: 16, font: DOC.SERIF });
    s += text(M, 62, `${input.projectName} · ${input.community}`, { size: 4.2, fill: DOC.INK_2 });
    s += text(M, 74, `Renders · drawings · bill of quantities · price — rev ${input.rev}, ${input.dateISO}`, { size: 3.4, fill: DOC.INK_2 });
    s += label(M, 98, "Estimated total incl. contingency and VAT");
    s += text(M, 112, `AED ${aed(input.boq.grand_total_aed)}`, { size: 9, font: DOC.MONO, attrs: `data-grand-total="${input.boq.grand_total_aed}"` });
    if (excludes) s += text(M, 120, excludes, { size: 3.2, weight: 600 });
    const facts = [
      `Floor ${input.room.area_m2.toFixed(2)} m² · ceiling ${input.room.ceiling_mm} mm · walls tiled ${input.room.tiled}`,
      // B8: the pack carries the views that passed both checks; the rest are named on page 2, never shown.
      `${input.views.filter((v) => v.render).length} of ${input.views.length} views from your photos in this pack${input.anchorLabel ? ` · finishes follow ${input.anchorLabel} (locked)` : ""}`,
      `${input.sheets.length} drawings · ${input.boq.sections.reduce((n, s) => n + s.lines.length, 0)} lines in the bill of quantities`,
      ...(input.boq.options?.length ? [`${input.boq.options.length} options priced separately`] : []),
    ];
    let fy = 138;
    for (const f of facts) {
      s += text(M, fy, f, { size: 3.4 });
      fy += 7;
    }
    s += `<rect x="${M}" y="${PACK_H - 34}" width="${(PACK_W - 2 * M) * 0.48}" height="16" fill="${DOC.INK}"/>`;
    s += text(M + 4, PACK_H - 23.5, "FOR REVIEW — NOT FOR CONSTRUCTION", { size: 3.6, fill: "#FFFFFF", font: DOC.MONO, weight: 600 });
    const hero = input.views.find((v) => v.anchor && v.render) ?? input.views.find((v) => v.render);
    const slots: PackSlot[] = hero?.render ? [{ src: hero.render.src, x: 240, y: 16, w: 164, h: 258 }] : [];
    if (hero) s += text(240 + 82, 280, `${hero.label.split(" · ")[0]} — ${hero.origin}${hero.anchor ? " · locked, anchors the room" : ""}`, { size: 2.8, fill: DOC.INK_2, anchor: "middle", font: DOC.MONO });
    push("cover", "Cover", s, slots);
  }

  // --- room plan with the photo markers -------------------------------------------------------
  {
    let s = frame(input, "The room and your photos", pages.length + 1);
    s += roomPlanSvg(input, M, 40, 210, 220);
    let y = 44;
    s += label(250, y, "Views");
    y += 6;
    for (const v of input.views) {
      s += text(250, y, `P${v.n}`, { size: 3.4, font: DOC.MONO, weight: 600 });
      s += text(264, y, `${v.label.split(" · ")[0]} — ${v.origin}${v.anchor ? " · anchors the room" : v.locked ? " · locked" : ""}`, { size: 3.2 });
      y += 5;
      s += text(264, y, v.camera ? `taken facing ${Math.round(v.camera.heading_deg)}°` : "not placed on the plan", { size: 2.8, fill: DOC.INK_2, font: DOC.MONO });
      if (!v.render) {
        y += 4.6;
        s += text(264, y, `Not in this pack — ${(v.pending ?? "no render kept this photo's layout").replace(/^View pending — /, "")}`, { size: 2.8, fill: DOC.INK_2, attrs: `data-view-omitted="P${v.n}"` });
      }
      y += 7;
    }
    y += 4;
    const omitted = input.views.some((v) => !v.render);
    for (const line of wrapWords(`Each view is your own photo, restyled — the layout of the room is the photo's; the finishes are the design's. The marker is where it was taken; the line, the way the phone faced.${omitted ? " This pack carries only the views that passed both checks — the layout of your photo and the finishes of the locked view. A render that moves, resizes or adds a fixture is never shown." : ""}`, 70)) {
      s += text(250, y, line, { size: 3, fill: DOC.INK_2 });
      y += 4.6;
    }
    push("room_plan", "The room and your photos", s);
  }

  // --- one page per view that passed --------------------------------------------------------------
  // B8: a view with no render that passed both checks has no page (B7 drew a
  // placeholder): it is named on the room page, with why.
  for (const v of input.views.filter((x) => x.render)) {
    let s = frame(input, `${v.label.split(" · ")[0]} — ${v.origin}`, pages.length + 1);
    const slots: PackSlot[] = [];
    if (v.render) slots.push({ src: v.render.src, x: M, y: 36, w: 150, h: 240 });
    if (v.photo) {
      slots.push({ src: v.photo.src, x: 176, y: 36, w: 70, h: 112 });
      s += text(176 + 35, 154, "Your photo", { size: 2.8, fill: DOC.INK_2, font: DOC.MONO, anchor: "middle" });
    }
    let y = 44;
    const cx = 262;
    s += label(cx, y, "Origin");
    s += text(cx, y + 6, v.origin === "from your photo" ? "From your photo — restyled, its layout kept" : "Concept — no photo from here", { size: 3.4 });
    y += 18;
    s += label(cx, y, "Design checks");
    y += 6;
    for (const c of v.render ? v.checks : []) {
      for (const [i, line] of wrapWords(`${c.ok ? "✓" : "✗"} ${c.text.replace(/ ✓$/, "")}`, 52).entries()) {
        s += text(cx + (i ? 3 : 0), y, line, { size: 3.1, fill: c.ok ? DOC.INK : DOC.INK_2 });
        y += 4.8;
      }
    }
    y += 3;
    for (const line of wrapWords("Small fittings — taps, rails, hooks, a shower riser — are not checked and may differ from the photo.", 56)) {
      s += text(cx, y, line, { size: 2.8, fill: DOC.INK_2 });
      y += 4.2;
    }
    if (v.render) s += text(cx, y + 4, `Version ${v.render.version}${v.anchor ? " · locked — every other view follows its finishes" : v.locked ? " · locked" : ""}`, { size: 2.8, fill: DOC.INK_2, font: DOC.MONO });
    push("view", `${v.label}`, s, slots);
  }

  // --- the drawings: the sheets themselves ------------------------------------------------------------
  for (const sh of input.sheets) pages.push({ kind: "drawing", title: `${sh.number} ${sh.title}`, svg: sh.svg, images: [] });

  // --- materials & finishes ------------------------------------------------------------------------
  {
    let s = frame(input, "Materials and finishes", pages.length + 1);
    let y = 44;
    if (input.spec?.length) {
      s += label(M, y, "Element") + label(90, y, "Finish");
      y += 3;
      s += hline(M, R, y, DOC.STRONG, 0.5);
      for (const e of input.spec) {
        const lines = wrapWords(e.finish, 120);
        s += text(M, y + 6, e.element.replace(/^./, (c) => c.toUpperCase()), { size: 3.4, weight: 500 });
        lines.forEach((l, i) => (s += text(90, y + 6 + i * 5, l, { size: 3.4 })));
        y += 4 + lines.length * 5 + 2;
        s += hline(M, R, y);
      }
      y += 8;
      for (const line of wrapWords(`Read from ${input.anchorLabel ?? "the locked view"} — the view that anchors the room. Samples and exact products are confirmed with your contractor before ordering.`, 140)) {
        s += text(M, y, line, { size: 3, fill: DOC.INK_2 });
        y += 4.6;
      }
    } else s += text(M, y, "No view is locked yet — the finishes follow your references until one is.", { size: 3.4, fill: DOC.INK_2 });
    push("materials", "Materials and finishes", s);
  }

  // --- the BoQ by section ---------------------------------------------------------------------------------
  {
    const X = { desc: M, qty: 300, unit: 304, amount: R };
    let n = 0;
    let s = "";
    let y = 0;
    const start = () => {
      n++;
      s = frame(input, n === 1 ? "Bill of quantities" : "Bill of quantities (continued)", pages.length + 1);
      y = 40;
      s += label(X.desc, y, "Description") + label(X.qty, y, "Qty", { anchor: "end" }) + label(X.unit, y, "Unit") + label(X.amount, y, "Amount, AED", { anchor: "end" });
      y += 3;
      s += hline(M, R, y, DOC.STRONG, 0.5);
    };
    const flush = () => push("boq", "Bill of quantities", s);
    start();
    for (const sec of input.boq.sections) {
      if (y + 16 > PACK_H - 20) {
        flush();
        start();
      }
      y += 7;
      s += text(X.desc, y, sec.work_section, { size: 3.6, weight: 600 });
      s += text(X.amount, y, aed(sec.section_total_aed), { size: 3.4, font: DOC.MONO, anchor: "end", weight: 600, attrs: `data-section-total="${esc(sec.work_section)}"` });
      y += 1.6;
      for (const l of sec.lines) {
        const desc = wrapWords(l.description, 150).slice(0, 2);
        if (y + desc.length * 4.6 + 2 > PACK_H - 20) {
          flush();
          start();
        }
        y += 4.8;
        desc.forEach((d, i) => (s += text(X.desc + 3, y + i * 4.4, d, { size: 3 })));
        s += text(X.qty, y, String(l.quantity), { size: 3, font: DOC.MONO, anchor: "end" });
        s += text(X.unit, y, l.unit.replace(/\bm2\b/g, "m²"), { size: 3, fill: DOC.INK_2 });
        s += text(X.amount, y, unpriced(l) ? "to be priced" : aed(l.total_aed), { size: unpriced(l) ? 2.8 : 3, font: DOC.MONO, anchor: "end", fill: unpriced(l) ? DOC.INK_3 : DOC.INK });
        y += (desc.length - 1) * 4.4;
      }
      y += 2;
      s += hline(M, R, y);
    }
    flush();
  }

  // --- the price ---------------------------------------------------------------------------------------
  {
    let s = frame(input, "Price", pages.length + 1);
    let y = 46;
    const row = (k: string, v: string, attrs = "", bold = false) => {
      s += text(M, y, k, { size: 3.6, weight: bold ? 600 : undefined });
      s += text(220, y, v, { size: 3.6, font: DOC.MONO, anchor: "end", weight: bold ? 600 : undefined, attrs });
      y += 3;
      s += hline(M, 220, y);
      y += 6;
    };
    for (const sec of input.boq.sections) row(sec.work_section, aed(sec.section_total_aed));
    row("Subtotal", aed(input.boq.subtotal_aed), 'data-summary="subtotal"', true);
    if (input.boq.ohp_aed) row(`Overheads & profit ${input.boq.ohp_pct}%`, aed(input.boq.ohp_aed));
    row(`Contingency ${input.boq.contingency_pct}%`, aed(input.boq.contingency_aed));
    row(`VAT ${input.boq.vat_pct}%`, aed(input.boq.vat_aed));
    row("Total", `AED ${aed(input.boq.grand_total_aed)}`, `data-grand-total="${input.boq.grand_total_aed}"`, true);
    // B7 1d: a line still to be priced is on the page, beside the total, never inside it.
    for (const l of unpricedLines) row(l.description, "TBC — not in total", `data-tbc="${esc(l.description)}"`);
    // B7 1e → B9: how much of the price rests on our own estimates — by VALUE, the line count beside it.
    const share = allowanceShare(input.boq.sections);
    y += 2;
    for (const line of wrapWords(`AED ${aed(share.allowance_aed)} of the AED ${aed(share.base_aed)} of work (${share.pct.toFixed(1)}%) is priced on our own estimates (allowances, ${share.allowance_lines} of ${share.lines} lines), for the QS to confirm.`, 80)) {
      s += text(M, y, line, { size: 3.3, weight: 600, attrs: `data-allowances="${share.allowance_lines}" data-lines="${share.lines}" data-allowance-aed="${share.allowance_aed}" data-allowance-pct="${share.pct}"` });
      y += 5;
    }
    let oy = 46;
    const ox = 240;
    const opts = input.boq.options ?? [];
    if (opts.length) {
      s += label(ox, oy, "Options — priced separately, not in the total");
      oy += 7;
      for (const o of opts) {
        s += text(ox, oy, o.label, { size: 3.4, weight: 600 });
        s += text(R, oy, `+ AED ${aed(o.delta_total_aed ?? o.net_aed)}`, { size: 3.4, font: DOC.MONO, anchor: "end", attrs: `data-option="${esc(o.key)}" data-option-delta="${o.delta_total_aed ?? ""}"` });
        oy += 5.4;
        for (const line of wrapWords(`${o.note} ${o.delta_total_aed != null ? "Incl. contingency and VAT." : ""}`, 74)) {
          s += text(ox, oy, line, { size: 2.9, fill: DOC.INK_2 });
          oy += 4.4;
        }
        oy += 5;
      }
    }
    push("price", "Price", s);
  }

  // --- the programme ------------------------------------------------------------------------------------
  if (input.programme?.phases.length) {
    const p = input.programme;
    let s = frame(input, "Indicative programme", pages.length + 1);
    s += text(M, 40, `≈ ${p.total_days} working days (${p.low_days}–${p.high_days}) — derived from this room's quantities`, { size: 4, font: DOC.MONO, attrs: `data-programme-days="${p.total_days}"` });
    const barX = 150, barW = R - barX;
    let y = 52;
    for (const ph of p.phases) {
      s += text(M, y + 3.2, ph.label, { size: 3.2 });
      if (ph.basis) s += text(M, y + 7.4, ph.basis, { size: 2.6, fill: DOC.INK_2, font: DOC.MONO });
      s += text(barX - 4, y + 3.2, `${ph.days} d`, { size: 3, fill: DOC.INK_2, font: DOC.MONO, anchor: "end" });
      s += hline(barX, R, y + 2.2);
      const x0 = barX + (ph.start_day / p.total_days) * barW; // start_day is 0-based
      s += `<rect x="${x0.toFixed(1)}" y="${(y + 0.6).toFixed(1)}" width="${Math.max(0.8, (ph.days / p.total_days) * barW).toFixed(1)}" height="3.2" fill="${DOC.INK}" data-programme-phase="${esc(ph.label)}"/>`;
      y += ph.basis ? 12 : 8;
    }
    y += 6;
    for (const line of wrapWords(`${p.basis} A conversation starter for your contractor's own programme — never a commitment.`, 150)) {
      s += text(M, y, line, { size: 3, fill: DOC.INK_2 });
      y += 4.6;
    }
    push("programme", "Indicative programme", s);
  }

  return pages;
}
