// =============================================================================
// scripts/b2-recheck-style.ts — bathroom pilot B2: the style check, run again
// on photo views already rendered (no new render). For when the check changes
// (STYLE_CHECK_VERSION) — the live run's P1 passed v1 with the old tiles and the
// damaged ceiling still in the render; v2 judges the render beside the photo.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs scripts/b2-recheck-style.ts
//
// Updates each latest photo-view render's gate (style verdict, style line,
// style_check_version) and records the check's spend. Dev test project a2661f34.
// =============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { checkCostUsd, checkStyle, styleLine, STYLE_CHECK_VERSION, type CheckItem } from "@/lib/render/photo-check";
import { styleElementsFor, type StyleBrief } from "@/lib/render/photo-restyle";
import type { PhotoViewGate } from "@/lib/render/photo-view-run";
import { recordSpend, type SpendRow } from "@/lib/render/render-spend";
import type { ReferenceStyle } from "@/lib/render/reference-style";

const P = "a2661f34-9d96-4020-a755-40359440c302";
const { url, key } = resolveTarget({ script: "b2-recheck-style", writes: true });
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as SupabaseClient;
const { data: brief } = await db.from("project_briefs").select("reference_style").eq("project_id", P).single<{ reference_style: ReferenceStyle }>();
const style: StyleBrief = { text: brief!.reference_style.text, source: "references", line: "", elements: brief!.reference_style.elements };
const { data: renders } = await db.from("renders").select("id, room_photo_id, image_url, source_image_url, gate, created_at").eq("project_id", P).eq("mode", "photo_view").order("created_at");
const latest = new Map<string, { id: string; image_url: string | null; source_image_url: string; gate: PhotoViewGate }>();
for (const r of (renders ?? []) as { id: string; room_photo_id: string; image_url: string | null; source_image_url: string; gate: PhotoViewGate }[]) latest.set(r.room_photo_id, r);
const spend: SpendRow[] = [];
const b64 = async (u: string) => Buffer.from(await (await fetch(u)).arrayBuffer()).toString("base64");
for (const [photoId, r] of latest) {
  if (r.gate.outcome !== "passed" || !r.image_url) continue;
  const kinds = new Set(r.gate.checked.map((ref) => r.gate.items.find((i: CheckItem) => i.ref === ref)?.kind).filter(Boolean) as CheckItem["kind"][]);
  const v = await checkStyle({ mediaType: "image/jpeg", data: await b64(r.image_url) }, styleElementsFor(style, kinds), { mediaType: "image/jpeg", data: await b64(r.source_image_url) });
  const before = r.gate.style_line;
  const gate = { ...r.gate, style_line: styleLine(v, "references"), style_check_version: STYLE_CHECK_VERSION, attempts: r.gate.attempts.map((a, i, all) => (i === all.length - 1 ? { ...a, style: { score: v.score, passed: v.passed, elements: v.elements } } : a)) };
  await db.from("renders").update({ gate }).eq("id", r.id);
  spend.push({ project_id: P, purpose: "photo_check", model: "claude-opus-5-5", cost_usd: checkCostUsd(v.usage), render_id: r.id, room_photo_id: photoId, detail: { step: "style_recheck", version: STYLE_CHECK_VERSION } });
  console.log(`${photoId.slice(0, 8)}: ${before}  →  ${gate.style_line}  (score ${v.score}: ${v.elements.map((e) => `${e.element}:${e.verdict}`).join(" ")})`);
}
await recordSpend(db, spend);
console.log(`style rechecks: ${spend.length}, $${spend.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)}`);
