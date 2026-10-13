// =============================================================================
// lib/render-lock-progress.ts — how far the owner's renders are locked (K10 #5).
// Pure, client-safe.
//
// One lockable view per RENDERABLE room or zone (the type has something to
// photograph — roomTypeFromDb): a design is locked per room (approved_designs),
// and the room's evening and extra camera views follow its locked day view.
// The rail's 03 Renders is Done only when every one is locked; otherwise
// Available with "N / M locked" — the same words on the Projects home's Next.
// =============================================================================

import { roomTypeFromDb } from "@/lib/render-prompts";

export interface RenderLockProgress {
  locked: number;
  total: number;
}

export function renderLockProgress(rooms: readonly { id: string; room_type: string | null }[], lockedRoomIds: Iterable<string>): RenderLockProgress {
  const renderable = rooms.filter((r) => roomTypeFromDb(r.room_type) !== null);
  const locked = new Set(lockedRoomIds);
  return { locked: renderable.filter((r) => locked.has(r.id)).length, total: renderable.length };
}
