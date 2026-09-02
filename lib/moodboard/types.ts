// =============================================================================
// lib/moodboard/types.ts — B2 moodboard vocabulary + descriptor derivation.
//
// A moodboard item is one of three things, and the distinction matters to the
// render pipeline (B3), not just to the UI:
//   style  — built-in art from lib/styles. Its descriptor is DERIVED from the
//            style system, deterministically. No model involved.
//   asset  — a user upload (project_assets, kind reference_image). Its
//            descriptor may be written by an LLM, which is the only thing an
//            LLM is permitted to contribute here.
//   render — a render the user liked, fed back in as a reference.
//
// Pure module: no DB, no React, no fetch. Unit-tested.
// =============================================================================

import { getStyleByKey, type Style } from "@/lib/styles";

export const MOODBOARD_KINDS = ["style", "asset", "render"] as const;
export type MoodboardKind = (typeof MOODBOARD_KINDS)[number];

/** The four room buckets the built-in style art covers. */
export const STYLE_ROOMS = [
  "living",
  "bedroom",
  "secondary-bedroom",
  "bathroom",
] as const;
export type StyleRoom = (typeof STYLE_ROOMS)[number];

export const STYLE_ROOM_LABEL: Record<StyleRoom, string> = {
  living: "Living",
  bedroom: "Master bedroom",
  "secondary-bedroom": "Second bedroom",
  bathroom: "Bathroom",
};

export interface MoodboardItem {
  id: string;
  project_id: string;
  kind: MoodboardKind;
  asset_id: string | null;
  render_id: string | null;
  style_key: string | null;
  style_room: string | null;
  image_url: string | null;
  descriptor: string | null;
  position: number;
  created_at?: string;
}

export function isMoodboardKind(x: unknown): x is MoodboardKind {
  return typeof x === "string" && (MOODBOARD_KINDS as readonly string[]).includes(x);
}

export function isStyleRoom(x: unknown): x is StyleRoom {
  return typeof x === "string" && (STYLE_ROOMS as readonly string[]).includes(x);
}

/** Static path for a built-in style image (served from /public/moodboards). */
export function styleImagePath(styleKey: string, room: StyleRoom): string {
  return `/moodboards/${styleKey}-${room}.png`;
}

/** Every built-in style image, for the "add from the style library" picker. */
export function styleImageCatalog(styles: Style[]): {
  style_key: string;
  style_name: string;
  room: StyleRoom;
  label: string;
  image_url: string;
}[] {
  return styles.flatMap((s) =>
    STYLE_ROOMS.map((room) => ({
      style_key: s.key,
      style_name: s.name_en,
      room,
      label: `${s.name_en} · ${STYLE_ROOM_LABEL[room]}`,
      image_url: styleImagePath(s.key, room),
    })),
  );
}

/**
 * Descriptor for a built-in style image, derived from the style system.
 * Deterministic — the same style always yields the same sentence, so a render
 * conditioned on it is reproducible.
 */
export function styleDescriptor(styleKey: string, room: StyleRoom | null): string | null {
  const s = getStyleByKey(styleKey);
  if (!s) return null;
  const where = room ? `${STYLE_ROOM_LABEL[room].toLowerCase()}: ` : "";
  return `${where}${s.name_en} — ${s.one_line} Palette ${s.palette.join(", ")}.`;
}

/** Resolve an item's descriptor, preferring a stored one over the derived one. */
export function descriptorFor(item: MoodboardItem): string | null {
  if (item.descriptor && item.descriptor.trim()) return item.descriptor.trim();
  if (item.kind === "style" && item.style_key) {
    return styleDescriptor(item.style_key, isStyleRoom(item.style_room) ? item.style_room : null);
  }
  return null;
}

/**
 * The prompt clause that carries a board's taste into a render (B3).
 *
 * Style DESCRIPTIONS only — never a quantity, never a dimension, never anything
 * about plan geometry. The edit model reads architecture from the source image;
 * these references are allowed to influence palette, material and mood, and
 * nothing else. `cap` bounds the clause so a large board cannot drown out the
 * style and room instructions that precede it.
 */
export function buildReferenceClause(
  items: MoodboardItem[],
  cap = 6,
): string {
  const seen = new Set<string>();
  const descriptors: string[] = [];
  for (const it of items) {
    const d = descriptorFor(it);
    if (!d) continue;
    const norm = d.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    descriptors.push(d);
    if (descriptors.length >= cap) break;
  }
  if (descriptors.length === 0) return "";
  return `References: match the palette, materials and mood of the attached reference images — ${descriptors.join(" ")} Do not copy their layout or furniture placement.`;
}

/** Sort items into display/seed order: position, then insertion time. */
export function sortItems<T extends { position: number; created_at?: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.position - b.position ||
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
}

/**
 * Renumber a board after a move so positions stay dense (0..n-1). Returns the
 * items whose position actually changed, so the caller writes the minimum.
 */
export function reorder<T extends { id: string; position: number; created_at?: string }>(
  items: T[],
  movedId: string,
  toIndex: number,
): { id: string; position: number }[] {
  const sorted = sortItems(items);
  const from = sorted.findIndex((i) => i.id === movedId);
  if (from === -1) return [];
  const target = Math.max(0, Math.min(sorted.length - 1, toIndex));
  if (from === target) return [];
  const next = [...sorted];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next
    .map((item, idx) => ({ id: item.id, position: idx, was: item.position }))
    .filter((x) => x.position !== x.was)
    .map(({ id, position }) => ({ id, position }));
}
