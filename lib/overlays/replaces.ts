// =============================================================================
// lib/overlays/replaces.ts — a fixture that replaces another (bathroom pilot B7 3).
//
// A cabinet "replaces the bidet": the replacing fixture's spec says which one —
//   spec.replaces_fixture_id   the fixture it replaces (the picker on 01 Plan)
//   spec.replaces              that fixture's TYPE ("bidet_point"), which the
//                              render check reads (lib/render/photo-check.ts)
// The replaced fixture stays on the plan as what is on site today, but it is no
// longer part of the design: no point line, no wet-room line, no drawing, no
// render item — only the strip-out names it. One rule, applied by every reader
// that counts or draws the design's fixtures. Pure.
// =============================================================================

export function replacedIds(fixtures: readonly { id: string; spec?: Record<string, unknown> | null }[]): Set<string> {
  const ids = new Set(fixtures.map((f) => f.id));
  const out = new Set<string>();
  for (const f of fixtures) {
    const r = f.spec?.replaces_fixture_id;
    if (typeof r === "string" && r !== f.id && ids.has(r)) out.add(r);
  }
  return out;
}

/** The design's fixtures: every fixture another one does not replace. */
export function withoutReplaced<T extends { id: string; spec?: Record<string, unknown> | null }>(fixtures: readonly T[]): T[] {
  const gone = replacedIds(fixtures);
  return gone.size ? fixtures.filter((f) => !gone.has(f.id)) : [...fixtures];
}
