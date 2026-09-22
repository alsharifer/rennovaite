// =============================================================================
// lib/documents/pack-export/coverage.ts — which client photos make before/after
// pairs, and of which zone (T5, from scripts/garden-draft-pack.ts step 4).
//
// Two sources, in order:
//   1. ASSIGNED — photo assets the designer filed against a zone
//      (project_assets.room_id). The generic case.
//   2. REFERENCE — a garden drafted from a reference layout whose zones carry
//      `spec.ref_key` (the client garden, G5): its photo coverage table maps each
//      photo to a zone and the existing items it shows.
// A photo whose zone or asset cannot be found is SKIPPED with the reason, never
// guessed at.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PairCandidate {
  file: string;
  /** The zone this photo covers (reference key or zone id). */
  zone: string;
  zoneId: string | null;
  assetId: string | null;
  itemIds: string[];
}

export async function photoCoverage(db: SupabaseClient, projectId: string, maxZones: number): Promise<{ source: "assigned" | "reference" | "none"; queue: PairCandidate[] }> {
  const { data: plan } = await db.from("plans").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (!plan) return { source: "none", queue: [] };
  const [{ data: rooms }, { data: els }, { data: fx }, { data: assets }] = await Promise.all([
    db.from("rooms").select("id, name_en, spec").eq("plan_id", plan.id),
    db.from("plan_elements").select("id, spec").eq("plan_id", plan.id),
    db.from("plan_fixtures").select("id, spec, type").eq("project_id", projectId),
    db.from("project_assets").select("id, filename, room_id").eq("project_id", projectId).eq("kind", "photo"),
  ]);
  const photos = (assets ?? []) as { id: string; filename: string; room_id: string | null }[];

  // 1. Photos filed against a zone.
  const assigned = photos.filter((a) => a.room_id);
  if (assigned.length) {
    const byZone = new Map<string, typeof assigned>();
    for (const a of assigned) byZone.set(a.room_id!, [...(byZone.get(a.room_id!) ?? []), a]);
    const zones = [...byZone.keys()].slice(0, maxZones);
    return {
      source: "assigned",
      queue: zones.flatMap((z) => byZone.get(z)!.slice(0, 2).map((a) => ({ file: a.filename, zone: z, zoneId: z, assetId: a.id, itemIds: [] }))),
    };
  }

  // 2. A garden drafted from a reference layout.
  const refRooms = ((rooms ?? []) as { id: string; name_en: string; spec: { ref_key?: string } | null }[]).filter((r) => r.spec?.ref_key);
  if (!refRooms.length) return { source: "none", queue: [] };
  const { PHOTO_COVERAGE, RUNS, TREES, ZONES } = await import("@/lib/client-garden/arabella-reference");
  const idForKey = (key: string): string | null => {
    const z = ZONES.find((x) => x.key === key);
    if (z) return refRooms.find((r) => r.spec?.ref_key === key)?.id ?? ((rooms ?? []) as { id: string; name_en: string }[]).find((r) => r.name_en === z.name)?.id ?? null;
    const run = RUNS.find((x) => x.key === key);
    if (run) return ((els ?? []) as { id: string; spec: { name?: string } | null }[]).find((e) => e.spec?.name === run.name)?.id ?? null;
    const t = TREES.find((x) => x.key === key);
    if (t) return ((fx ?? []) as { id: string; spec: { name?: string } | null }[]).find((f) => f.spec?.name === t.name)?.id ?? null;
    return null;
  };
  const zones = [...new Set(PHOTO_COVERAGE.map((c) => c.zone))].slice(0, maxZones);
  return {
    source: "reference",
    queue: zones.flatMap((z) =>
      PHOTO_COVERAGE.filter((c) => c.zone === z)
        .slice(0, 2)
        .map((c) => ({
          file: c.file,
          zone: c.zone,
          zoneId: idForKey(c.zone),
          assetId: photos.find((a) => a.filename === c.file)?.id ?? null,
          itemIds: c.shows.map(idForKey).filter((x): x is string => !!x),
        })),
    ),
  };
}
