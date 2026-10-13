// =============================================================================
// scripts/lib/k11-scratch.mjs — the K11 scratch owner project: no firm, one
// stored BoQ revision = the Arabella G5d fixture's stage 7 as H7 regeneration
// prices it (reroundRevision, engine 0.3.0) — 15 counted lines, 3 to be priced
// (SFT-03 planting beds, PLB-01 outdoor tap, PLB-02 drainage point), grand
// 116,679.56. Created as the dev account `who`; `cleanup()` removes it and every
// row it gathered (boqs, corrections, events). No real project is read or written.
// =============================================================================

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

/** The stage-7 revision as H7 regeneration prices it, computed by the app's own module. */
export function arabellaStage7() {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-transform-types",
        "--import",
        "./scripts/_alias-hook.mjs",
        "-e",
        `const { reroundRevision } = await import("@/lib/boq/totals"); const fx = JSON.parse((await import("node:fs")).readFileSync("lib/boq/__fixtures__/arabella-g5d-revisions.json", "utf8")); process.stdout.write(JSON.stringify(reroundRevision(fx.boqs[fx.stages[7].boq_id])));`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ),
  );
}

export async function createScratchOwnerProject(sb, userId, { name = "Garden — K11 scratch", boq = arabellaStage7(), createdAt } = {}) {
  const P = randomUUID();
  await sb.from("projects").insert({ id: P, name, city: "Dubai", created_by: userId }).throwOnError();
  await sb.from("project_members").insert({ project_id: P, user_id: userId }).throwOnError();
  const { data: b } = await sb
    .from("boqs")
    .insert({ project_id: P, total_aed: boq.grand_total_aed, sections: boq, ...(createdAt ? { created_at: createdAt } : {}) })
    .select("id")
    .single()
    .throwOnError();
  return {
    projectId: P,
    boqId: b.id,
    async cleanup() {
      await sb.from("pilot_events").delete().eq("project_id", P);
      await sb.from("boq_corrections").delete().eq("project_id", P);
      await sb.from("boqs").delete().eq("project_id", P);
      await sb.from("projects").delete().eq("id", P);
    },
  };
}
