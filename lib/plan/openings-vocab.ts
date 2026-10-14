// =============================================================================
// lib/plan/openings-vocab.ts — the words for openings found on the drawing
// (R10b, spec §7.5). CLIENT-SAFE and pure.
//
// The detector (lib/plan/openings-detect.ts, server) finds windows, doors and
// open passages on the drawing and stores them as plan_openings rows with
// source 'detected'. Until the owner confirms one it is DERIVED: it shapes the
// renders at once (labelled) but never the BoQ. Confirmed = measured; it takes
// effect on the next regenerate (cause "Openings confirmed").
// =============================================================================

export type OpeningKind = "door" | "window" | "archway" | "gate";

/** What the detector recorded beside a detected row (plan_openings.detection). */
export interface DetectionMeta {
  /** The room on the other side, when the opening is between two rooms. */
  opens_to_room_id?: string | null;
  /** "outside" for an external window or door; "room" otherwise; null unknown. */
  opens_to?: "outside" | "room" | null;
  floor_to_ceiling?: boolean;
  confidence?: number;
  note?: string | null;
  model?: string;
  run_at?: string;
  /** What the model read: the side of the room and where along it (0–1), before snapping. */
  read?: { side: string; start: number; end: number };
  /** "printed" = a dimension on the drawing gave the width (measured); "estimated" = read off the drawing (derived). */
  width_source?: "printed" | "estimated";
  /** The opening joins this many readings split by mullions. */
  merged_from?: number;
}

/** A plan's detection state (plans.openings_detection). */
export interface DetectionRun {
  /** no_frame = the stored rooms cannot be related to the drawing (nothing is guessed). */
  status: "running" | "done" | "no_drawing" | "no_frame" | "failed";
  started_at?: string;
  finished_at?: string;
  found?: number;
  dropped?: number;
  model?: string;
  error?: string | null;
  /** "auto" (once, when the plan was read or first opened) | "redetect" (on demand). */
  mode?: "auto" | "redetect";
}

/** A running claim older than this is treated as dead and may be claimed again. */
export const DETECTION_STALE_MS = 4 * 60_000;

export interface OpeningRowLike {
  id: string;
  kind: string;
  room_id: string | null;
  source: string | null;
  confirmed_at?: string | null;
  detection?: DetectionMeta | null;
}

/** An opening that came from the drawing and nobody has confirmed — derived, never priced. */
export function isUnconfirmedDetected(o: Pick<OpeningRowLike, "source" | "confirmed_at">): boolean {
  return o.source === "detected" && !o.confirmed_at;
}

/** True while a running claim is still alive. */
export function detectionRunning(run: DetectionRun | null | undefined, now: number = Date.now()): boolean {
  if (!run || run.status !== "running") return false;
  const t = run.started_at ? Date.parse(run.started_at) : NaN;
  return Number.isFinite(t) && now - t < DETECTION_STALE_MS;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? `${/^[aeiou]/i.test(one) ? "an" : "a"} ${one}` : `${n} ${many}`);
const word = (n: number) => (n === 1 ? "a" : n === 2 ? "2" : String(n));

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * "We found 2 windows and an opening to the kitchen — correct?" Built from the
 * UNCONFIRMED detected openings only. A passage between two rooms is named by
 * the room it opens to (seen from `roomId` when given, else from the room it
 * was found in). Null when there is nothing to confirm.
 */
export function openingsSentence(
  openings: readonly OpeningRowLike[],
  roomName: (id: string) => string | null,
  roomId?: string | null,
): string | null {
  const pending = openings.filter(isUnconfirmedDetected);
  if (pending.length === 0) return null;
  const windows = pending.filter((o) => o.kind === "window");
  const doors = pending.filter((o) => o.kind === "door" || o.kind === "gate");
  const passages = pending.filter((o) => o.kind === "archway");
  const parts: string[] = [];
  if (windows.length) {
    const ftc = windows.filter((o) => o.detection?.floor_to_ceiling).length;
    parts.push(ftc === windows.length ? `${plural(windows.length, "floor-to-ceiling window")}` : plural(windows.length, "window"));
  }
  if (doors.length) parts.push(plural(doors.length, "door"));
  if (passages.length) {
    const names = new Set<string>();
    let unnamed = 0;
    for (const p of passages) {
      const other = roomId && p.detection?.opens_to_room_id === roomId ? p.room_id : roomId && p.room_id === roomId ? p.detection?.opens_to_room_id : p.detection?.opens_to_room_id;
      const n = other ? roomName(other) : null;
      if (n) names.add(n.toLowerCase());
      else unnamed++;
    }
    if (names.size) parts.push(`${names.size + unnamed === 1 ? "an opening" : "openings"} to the ${joinAnd([...names])}${unnamed ? ` and ${plural(unnamed, "other opening")}` : ""}`);
    else parts.push(passages.length === 1 ? "an opening" : `${word(passages.length)} openings`);
  }
  return `We found ${joinAnd(parts)} — correct?`;
}

/**
 * The width as the panel shows it: "≈ 1.80 m — check" while the size is derived
 * (estimated off the drawing, or defaulted) — confirming an opening fixes its
 * position and kind, never its width; "1.80 m" once measured (edited on the plan,
 * or printed on the drawing).
 */
export function openingWidthLabel(o: { width_mm?: number | null; derived?: boolean | null }): { text: string; derived: boolean } | null {
  if (!o.width_mm) return null;
  const m = (o.width_mm / 1000).toFixed(2);
  return o.derived ? { text: `≈ ${m} m — check`, derived: true } : { text: `${m} m`, derived: false };
}

/** Counted openings (confirmed or drawn) whose size is still derived — "widths to check". */
export function widthsToCheck<T extends OpeningRowLike & { derived?: boolean | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !isUnconfirmedDetected(r) && r.derived === true && r.kind !== "gate");
}

/** One row's label in the confirmation list: "Window · Dining room → outside · ~1.80 m". */
export function openingRowLabel(o: OpeningRowLike & { width_mm?: number | null }, roomName: (id: string) => string | null): { title: string; where: string } {
  const kind = o.kind === "archway" ? "Opening" : o.kind === "window" ? (o.detection?.floor_to_ceiling ? "Floor-to-ceiling window" : "Window") : o.kind === "gate" ? "Gate" : "Door";
  const room = (o.room_id && roomName(o.room_id)) || "Unassigned";
  const other = o.detection?.opens_to_room_id ? roomName(o.detection.opens_to_room_id) : null;
  const to = other ? ` → ${other}` : o.detection?.opens_to === "outside" ? " → outside" : "";
  return { title: kind, where: `${room}${to}` };
}

/** The label on a render built while some of its room's openings were unconfirmed. */
export const DETECTED_RENDER_LABEL = "Windows and doors detected from your drawing — not yet confirmed";
export const CONFIRMED_RENDER_LABEL = "Windows and doors from your confirmed plan";

/** What the confirmation panel says about the rule. */
export const OPENINGS_RULE =
  "Found openings shape your renders now, labelled as detected. They change the BoQ only once you confirm them — on the next regenerate. Confirming fixes where an opening is and what it is; its width stays an estimate until you edit it on the plan.";

/** The revision cause when confirmed openings move a regenerated BoQ. */
export const OPENINGS_CONFIRMED_CAUSE = "Openings confirmed";

/** BoQ items whose quantity is net of openings (lib/boq/quantify.ts). */
export const OPENING_NET_ITEM_KEYS = ["wall_plaster", "wall_paint", "wet_tiling"] as const;

/** Per-render record of which openings shaped an off-plan render (renders.openings_basis). */
export interface OpeningsBasis {
  confirmed: number;
  detected: number;
  ids: string[];
}

export function renderOpeningsLabel(basis: OpeningsBasis | null | undefined): string | null {
  if (!basis || basis.confirmed + basis.detected === 0) return null;
  return basis.detected > 0 ? DETECTED_RENDER_LABEL : CONFIRMED_RENDER_LABEL;
}
