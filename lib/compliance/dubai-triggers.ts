// =============================================================================
// lib/compliance/dubai-triggers.ts — Dubai permit-trigger rules (P6).
//
// Machine-checkable predicates over the as-built→proposed plan diff (+ fixtures).
// NOT an LLM guessing regulations, NOT the full compliance engine (Phase 2a).
// Every rule cites a source_note — we cite where the rule comes from; we do not
// give legal advice. Where the parse can't confirm a wall is structural
// (is_structural === null), wall rules surface uncertainty rather than assert.
// =============================================================================

import type { PlanFixture } from "@/lib/overlays/types";
import type { PlanGraph, Room } from "@/lib/plan/geometry";

import { resolveAuthority, type Authority, type CommunityAuthority } from "./authorities";
import type { PlanDiff } from "./diff";

export type Consequence =
  | "permit_required"
  | "noc_required"
  | "approval_likely"
  | "no_permit";

export interface PermitRule {
  id: string;
  authority: Authority; // 'DM' = municipal placeholder, resolved per community
  title_en: string;
  title_ar: string;
  predicate: (diff: PlanDiff, graph: PlanGraph, fixtures: PlanFixture[]) => boolean;
  consequence: Consequence;
  explanation_en: string;
  explanation_ar: string;
  source_note: string;
  /** true = generic/unconfirmed source → belongs on the consultant checklist. */
  source_weak: boolean;
}

export interface FiredRule {
  id: string;
  authority: Authority;
  title_en: string;
  title_ar: string;
  consequence: Consequence;
  explanation_en: string;
  explanation_ar: string;
  source_note: string;
  source_weak: boolean;
}

const WET = new Set(["bathroom", "ensuite", "powder", "toilet", "kitchen"]);
const EXTERNAL = new Set(["balcony", "terrace"]);
const isWet = (r: Room) => WET.has(r.type ?? "");
const isKitchen = (r: Room) => r.type === "kitchen";
const isExternal = (r: Room) => EXTERNAL.has(r.type ?? "");
const roomChanges = (d: PlanDiff) => [...d.removedRooms, ...d.addedRooms];
const wallChanges = (d: PlanDiff) => d.removedWalls.length + d.addedWalls.length;

const UNCERTAIN_EN =
  "We can't confirm from your plan whether this wall is structural — an engineer visit settles it.";
const UNCERTAIN_AR =
  "لا يمكننا التأكد من مخططك ما إذا كان هذا الجدار إنشائياً — زيارة مهندس تحسم الأمر.";

export const RULES: PermitRule[] = [
  {
    id: "structural_permit",
    authority: "DM",
    title_en: "Structural wall change or new structural opening",
    title_ar: "تعديل جدار إنشائي أو فتحة إنشائية جديدة",
    predicate: (d) => d.removedWalls.some((w) => w.is_structural === true) || d.addedWalls.some((w) => w.is_structural === true),
    consequence: "permit_required",
    explanation_en:
      "Altering a load-bearing wall or cutting a structural opening needs a building permit with drawings stamped by a licensed structural engineer.",
    explanation_ar:
      "تعديل جدار حامل أو عمل فتحة إنشائية يتطلب تصريح بناء بمخططات معتمدة من مهندس إنشائي مرخّص.",
    source_note: "Dubai Municipality building-permit requirements — structural modifications require a licensed structural engineer.",
    source_weak: false,
  },
  {
    id: "structural_uncertain",
    authority: "DM",
    title_en: "Structural status unconfirmed",
    title_ar: "الحالة الإنشائية غير مؤكدة",
    predicate: (d) => d.removedWalls.some((w) => w.is_structural === null) || d.addedWalls.some((w) => w.is_structural === null),
    consequence: "approval_likely",
    explanation_en: UNCERTAIN_EN,
    explanation_ar: UNCERTAIN_AR,
    source_note: "Derived geometry — the parse does not record whether a wall is structural (internal parse-confidence flag).",
    source_weak: true,
  },
  {
    id: "wall_removal_noc",
    authority: "community_developer",
    title_en: "Wall removal — community NOC",
    title_ar: "إزالة جدار — عدم ممانعة من المطوّر",
    predicate: (d) => d.removedWalls.length > 0,
    consequence: "noc_required",
    explanation_en:
      "Removing any internal wall generally needs a No-Objection Certificate from your community developer before works begin.",
    explanation_ar:
      "إزالة أي جدار داخلي تتطلب عادةً شهادة عدم ممانعة من مطوّر المجتمع قبل بدء الأعمال.",
    source_note: "Master-community developer handover/fit-out guides typically require an NOC for internal alterations.",
    source_weak: true,
  },
  {
    id: "new_partition_noc",
    authority: "community_developer",
    title_en: "New internal partitions",
    title_ar: "أقسام داخلية جديدة",
    predicate: (d) => d.addedWalls.length > 0,
    consequence: "noc_required",
    explanation_en:
      "Adding internal partitions usually needs a developer fit-out NOC, and depending on services may need a permit.",
    explanation_ar:
      "إضافة أقسام داخلية تتطلب عادةً عدم ممانعة للتجهيز من المطوّر، وقد تتطلب تصريحاً حسب الخدمات.",
    source_note: "Community fit-out guidelines — new partitions require a developer NOC.",
    source_weak: true,
  },
  {
    id: "room_addition_permit",
    authority: "DM",
    title_en: "Room addition / new enclosed area",
    title_ar: "إضافة غرفة / مساحة مغلقة جديدة",
    predicate: (d) => d.addedRooms.length > 0,
    consequence: "permit_required",
    explanation_en:
      "Enclosing new area or adding a room is a building-permit item — it changes the built-up area on record.",
    explanation_ar:
      "إغلاق مساحة جديدة أو إضافة غرفة يُعدّ من بنود تصريح البناء لأنه يغيّر المساحة المبنية المسجّلة.",
    source_note: "Dubai Municipality building-permit guidance — additions to built-up area require a permit.",
    source_weak: false,
  },
  {
    id: "footprint_permit",
    authority: "DM",
    title_en: "Footprint / gross-area change",
    title_ar: "تغيير في البصمة / المساحة الإجمالية",
    predicate: (d) => Math.abs(d.areaDeltaM2) >= 1,
    consequence: "permit_required",
    explanation_en:
      "A change to the gross floor area needs a building permit and an updated affection plan.",
    explanation_ar:
      "أي تغيير في إجمالي المساحة الأرضية يتطلب تصريح بناء وتحديث مخطط الموقع.",
    source_note: "Dubai Municipality building-permit guidance — gross-area changes require a permit.",
    source_weak: false,
  },
  {
    id: "wet_area_drainage",
    authority: "DM",
    title_en: "Wet-area relocation / new plumbing",
    title_ar: "نقل منطقة رطبة / سباكة جديدة",
    predicate: (d) => roomChanges(d).some(isWet),
    consequence: "approval_likely",
    explanation_en:
      "Moving a bathroom or kitchen, or adding drainage points, usually triggers a Dubai Municipality drainage/plumbing review.",
    explanation_ar:
      "نقل حمام أو مطبخ أو إضافة نقاط صرف يستدعي عادةً مراجعة صرف/سباكة من بلدية دبي.",
    source_note: "Dubai Municipality drainage-connection guidance — new/relocated wet points need review.",
    source_weak: true,
  },
  {
    id: "mep_ac",
    authority: "DM",
    title_en: "AC relocation — MEP approval",
    title_ar: "نقل التكييف — موافقة الأنظمة الكهروميكانيكية",
    predicate: (d, _g, fixtures) =>
      roomChanges(d).some((r) => fixtures.some((f) => f.type === "ac_point" && f.room_id === r.id)),
    consequence: "approval_likely",
    explanation_en:
      "Relocating air-conditioning beyond minor works usually needs an MEP submission for the revised cooling layout.",
    explanation_ar:
      "نقل التكييف بما يتجاوز الأعمال البسيطة يتطلب عادةً تقديم مخطط كهروميكانيكي معدّل.",
    source_note: "Dubai Municipality MEP approval guidance — non-minor AC changes need an MEP submission.",
    source_weak: true,
  },
  {
    id: "facade_external",
    authority: "DM",
    title_en: "External / façade change",
    title_ar: "تغيير خارجي / في الواجهة",
    predicate: (d) => roomChanges(d).some(isExternal) || d.addedOpenings.some((o) => o.type === "window"),
    consequence: "permit_required",
    explanation_en:
      "External or façade changes and new windows need a building permit, and usually a community design review.",
    explanation_ar:
      "التغييرات الخارجية أو في الواجهة والنوافذ الجديدة تتطلب تصريح بناء ومراجعة تصميم من المجتمع.",
    source_note: "Dubai Municipality permit + community design-review guidelines — façade/opening changes.",
    source_weak: false,
  },
  {
    id: "kitchen_relocation",
    authority: "DM",
    title_en: "Kitchen relocation — gas + drainage review",
    title_ar: "نقل المطبخ — مراجعة الغاز والصرف",
    predicate: (d) => roomChanges(d).some(isKitchen),
    consequence: "approval_likely",
    explanation_en:
      "Moving a kitchen affects gas and drainage routing — expect a gas-provider review and a Dubai Municipality drainage review.",
    explanation_ar:
      "نقل المطبخ يؤثر على مسارات الغاز والصرف — يُتوقع مراجعة من مزوّد الغاز ومراجعة صرف من بلدية دبي.",
    source_note: "Dubai Municipality drainage + gas-provider guidance — kitchen moves affect gas + drainage.",
    source_weak: true,
  },
  {
    id: "finishes_no_permit",
    authority: "DM",
    title_en: "Finishes-level works",
    title_ar: "أعمال على مستوى التشطيبات",
    predicate: (d) =>
      wallChanges(d) === 0 && roomChanges(d).length === 0 && d.addedOpenings.length === 0 && Math.abs(d.areaDeltaM2) < 1,
    consequence: "no_permit",
    explanation_en:
      "Paint, flooring, joinery and like-for-like finishes are generally permit-exempt as long as no walls, wet areas or the footprint change.",
    explanation_ar:
      "الدهان والأرضيات والنجارة والتشطيبات المماثلة معفاة عموماً من التصريح ما دامت الجدران والمناطق الرطبة والبصمة دون تغيير.",
    source_note: "Dubai Municipality minor-works guidance — like-for-like finishes are permit-exempt.",
    source_weak: false,
  },
];

/**
 * Evaluate the permit triggers for a diff. Returns the fired rules
 * (consequence !== 'no_permit'), with each rule's municipal placeholder
 * resolved to the community's actual authority. Zero fired → calm state.
 */
export function evaluatePermits(
  diff: PlanDiff,
  graph: PlanGraph,
  fixtures: PlanFixture[],
  community: CommunityAuthority,
): FiredRule[] {
  const fired: FiredRule[] = [];
  for (const rule of RULES) {
    if (rule.consequence === "no_permit") continue;
    if (!rule.predicate(diff, graph, fixtures)) continue;
    fired.push({
      id: rule.id,
      authority: resolveAuthority(rule.authority, community),
      title_en: rule.title_en,
      title_ar: rule.title_ar,
      consequence: rule.consequence,
      explanation_en: rule.explanation_en,
      explanation_ar: rule.explanation_ar,
      source_note: rule.source_note,
      source_weak: rule.source_weak,
    });
  }
  return fired;
}

/** Rules whose source_note is generic/unconfirmed — the consultant checklist. */
export function weakSourceRules(): { id: string; title_en: string; source_note: string }[] {
  return RULES.filter((r) => r.source_weak).map((r) => ({
    id: r.id,
    title_en: r.title_en,
    source_note: r.source_note,
  }));
}
