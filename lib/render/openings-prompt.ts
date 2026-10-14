// =============================================================================
// lib/render/openings-prompt.ts — a room's openings, in the words an off-plan
// render is given (R10b, spec §7.5). Pure.
//
// The off-plan shell used to be "a single window on one side wall" for every
// room. Openings found on the drawing feed the render at once — confirmed or
// not — and the render records which it used (renders.openings_basis) so the
// studio can label one built from unconfirmed finds. A room with no opening
// keeps its prompt byte-identical (the prompt is the cache key).
// =============================================================================

import { isUnconfirmedDetected, type DetectionMeta, type OpeningsBasis } from "@/lib/plan/openings-vocab";

export interface RoomOpening {
  id: string;
  kind: string;
  room_id: string | null;
  source: string | null;
  confirmed_at?: string | null;
  detection?: DetectionMeta | null;
}

/** The openings that belong to a room: in its walls, or a passage from the room next door. */
export function roomOpeningsFor<T extends RoomOpening>(openings: readonly T[], roomId: string): T[] {
  return openings.filter((o) => o.room_id === roomId || o.detection?.opens_to_room_id === roomId);
}

const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number, one: string, many = `${one}s`) => (n === 1 ? `${/^[aeiou]/.test(one) ? "an" : "a"} ${one}` : `${NUM[n] ?? n} ${many}`);

function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * "two floor-to-ceiling windows, a door and a wide open passage to the kitchen".
 * Null when the room has none. `roomName` names the room on the other side of a passage.
 */
export function openingsPhrase(list: readonly RoomOpening[], roomId: string, roomName: (id: string) => string | null): string | null {
  if (list.length === 0) return null;
  const windows = list.filter((o) => o.kind === "window");
  const ftc = windows.filter((o) => o.detection?.floor_to_ceiling).length;
  const doors = list.filter((o) => o.kind === "door" || o.kind === "gate").length;
  const passages = list.filter((o) => o.kind === "archway");
  const parts: string[] = [];
  if (ftc) parts.push(count(ftc, "floor-to-ceiling window"));
  if (windows.length - ftc) parts.push(count(windows.length - ftc, ftc ? "other window" : "window"));
  if (doors) parts.push(count(doors, "door"));
  const named = new Map<string, number>();
  let unnamed = 0;
  for (const p of passages) {
    const other = p.room_id === roomId ? p.detection?.opens_to_room_id : p.room_id;
    const n = other ? roomName(other) : null;
    if (n) named.set(n.toLowerCase(), (named.get(n.toLowerCase()) ?? 0) + 1);
    else unnamed++;
  }
  for (const [name, n] of named) parts.push(`${count(n, "wide open passage")} to the ${name}`);
  if (unnamed) parts.push(count(unnamed, "wide open passage"));
  return joinAnd(parts);
}

/** What the render was built from — confirmed vs detected-not-confirmed. */
export function openingsBasis(list: readonly RoomOpening[]): OpeningsBasis | null {
  if (list.length === 0) return null;
  const detected = list.filter(isUnconfirmedDetected).length;
  return { confirmed: list.length - detected, detected, ids: list.map((o) => o.id) };
}

/** Appended to the restyle prompt of an off-plan render whose room has openings. */
export function editOpeningsClause(phrase: string): string {
  return `OPENINGS: the room has exactly ${phrase}. Keep them where they are in the image; add no other windows, doors or openings.`;
}
