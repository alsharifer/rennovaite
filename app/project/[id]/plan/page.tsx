import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/blueprint/Button";
import { Icon } from "@/components/blueprint/Icon";
import { PlanCheckPanel } from "@/components/blueprint/plan/PlanCheckPanel";
import { loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
import { AtelierCanvas } from "@/components/blueprint/shell/AtelierCanvas";
import { FIRM_STEPS, OWNER_STEPS } from "@/lib/journey";
import { stepEyebrow } from "@/lib/journey-eyebrow";
import { disputesFromParsedJson, resolveDisputes } from "@/lib/parse/disputes";
import { planCheck, planCheckSentence } from "@/lib/plan/plan-check";
import { loadGardenSiteData, type GardenSiteData } from "@/lib/plan/garden-site-data";
import type { RawRoomInput } from "@/lib/overlays/viewbox";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { GardenSitePanel } from "./_components/garden-site-panel";
import { PlanLayers } from "./_components/plan-layers";
import { PlanNotAnalysed } from "./_components/plan-not-analysed";

/** Plan columns this page reads. `source` and the plot dimensions arrive with
 *  migration 031 and are absent (undefined) before it. */
interface PlanRow {
  id: string;
  total_area_m2: number | null;
  parsed_json: unknown;
  pdf_url: string | null;
  source?: string | null;
  plot_width_m?: number | null;
  plot_depth_m?: number | null;
}

export const dynamic = "force-dynamic";

const BEDROOM_TYPES = new Set(["master_bedroom", "bedroom"]);
const BATHROOM_TYPES = new Set(["bathroom", "ensuite", "powder"]);

function Shell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function CenteredMessage({ tone, children }: { tone: "error" | "muted"; children: ReactNode }) {
  // K5: a Blueprint state — an error is the inverse block, anything else a quiet line.
  return (
    <Shell>
      <div className="mx-auto max-w-[720px] px-6 py-10">
        {tone === "error" ? (
          <div role="alert" className="surface-inverse bg-bp-alert-surface px-5 py-4 text-bp-alert-ink">
            <p className="t-body-sm">{children}</p>
          </div>
        ) : (
          <p className="t-body-sm border border-dashed border-bp-line-hairline px-5 py-6 text-bp-ink-secondary">{children}</p>
        )}
      </div>
    </Shell>
  );
}

function formatM2(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n)} m²`;
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, name, city")
    .eq("id", projectId)
    .maybeSingle();

  if (projectErr) {
    return (
      <CenteredMessage tone="error">
        Error loading project: {projectErr.message}
      </CenteredMessage>
    );
  }
  if (!project) {
    // Shared boundary. The old copy printed the raw project UUID at the user.
    notFound();
  }

  // `source` / plot columns arrive with migration 031; fall back to the base
  // select so the plan step still renders against a pre-031 database.
  const planSb = supabase as unknown as SupabaseClient;
  const withSource = await planSb
    .from("plans")
    .select("id, total_area_m2, parsed_json, pdf_url, source, plot_width_m, plot_depth_m")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PlanRow>();
  const planRes = withSource.error
    ? await supabase
        .from("plans")
        .select("id, total_area_m2, parsed_json, pdf_url")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : withSource;
  const { data: plan, error: planErr } = planRes as {
    data: PlanRow | null;
    error: { message: string } | null;
  };

  if (planErr) {
    return (
      <CenteredMessage tone="error">
        Error loading plan: {planErr.message}
      </CenteredMessage>
    );
  }
  if (!plan) {
    return (
      <CenteredMessage tone="muted">
        No plan attached to this project yet.
      </CenteredMessage>
    );
  }

  // Prefer selecting `confidence` (migration 025); fall back to the base
  // columns if the column isn't applied yet so the page still renders. The
  // confidence column isn't in the generated types, so use the untyped client.
  const sb = supabase as unknown as SupabaseClient;
  const withConf = await sb
    .from("rooms")
    .select("id, name_en, name_ar, room_type, area_m2, polygon, confidence, unroofed")
    .eq("plan_id", plan.id)
    .order("name_en")
    .returns<RawRoomInput[]>();
  let roomList: RawRoomInput[];
  let roomsErr: { message: string } | null = null;
  if (withConf.error) {
    const base = await supabase
      .from("rooms")
      .select("id, name_en, name_ar, room_type, area_m2, polygon")
      .eq("plan_id", plan.id)
      .order("name_en");
    roomsErr = base.error;
    roomList = (base.data ?? []) as RawRoomInput[];
  } else {
    roomList = withConf.data ?? [];
  }

  if (roomsErr) {
    return (
      <CenteredMessage tone="error">
        Error loading rooms: {roomsErr.message}
      </CenteredMessage>
    );
  }

  // A room whose printed dimension and whose outline disagree materially. The
  // measurement was kept; the editor puts the choice in front of whoever is
  // reviewing the plan rather than leaving a flag nobody can act on.
  const parsedDisputes = disputesFromParsedJson(plan.parsed_json);
  const areaDisputes = resolveDisputes(
    parsedDisputes.disputes,
    parsedDisputes.rooms,
    roomList,
  );

  // G1. `parsedComplete` used to gate the WHOLE editor, so a plan with no
  // parsed_json rendered a parsing spinner that nothing would ever finish —
  // including an authored plan, which has no parsed_json by definition and
  // never will. An authored plan is ready the moment it exists; a parsed one
  // that produced nothing gets an actionable card, never a spinner.
  const authored = plan.source === "user_drawn";
  const plot =
    authored && plan.plot_width_m && plan.plot_depth_m
      ? { width_m: Number(plan.plot_width_m), depth_m: Number(plan.plot_depth_m) }
      : null;
  const planReady = authored || (plan.parsed_json !== null && roomList.length > 0);
  const parsedComplete = planReady;
  const gardenPilot = process.env.GARDEN_PILOT_ENABLED === "true";

  // G5: an authored garden's standing questions — draft status, what already
  // stands on site and the call on each, levels, pack readiness.
  let gardenSite: GardenSiteData | null = null;
  if (authored && gardenPilot) {
    try {
      gardenSite = await loadGardenSiteData(sb, projectId, plan.id);
    } catch (e) {
      console.warn("[plan] garden site panel skipped:", e instanceof Error ? e.message : e);
    }
  }

  // Real parse-quality KPI: mean room confidence + this plan's correction count
  // (replaces the old hard-coded "99.2% confidence"). Both best-effort.
  const confVals = roomList
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");
  const meanConfidencePct = confVals.length
    ? Math.round((confVals.reduce((s, c) => s + c, 0) / confVals.length) * 100)
    : null;
  let correctionsTotal: number | null = null;
  try {
    const pm = await sb
      .from("parse_metrics")
      .select("correction_total")
      .eq("plan_id", plan.id)
      .eq("kind", "corrections")
      .returns<{ correction_total: number | null }[]>();
    if (!pm.error) {
      correctionsTotal = (pm.data ?? []).reduce((s, r) => s + (r.correction_total ?? 0), 0);
    }
  } catch {
    /* parse_metrics absent pre-025 — leave null */
  }

  // K5: the plan check — THE overlap detector over the stored rooms (removed
  // site-reference zones are not in the design), and what the rail says is
  // blocked downstream because of the plan.
  const removedIds = new Set(
    Object.entries(gardenSite?.siteRefs ?? {})
      .filter(([, s]) => s.site_reference && s.disposition === "remove")
      .map(([id]) => id),
  );
  const check = planCheck(roomList.filter((r) => !removedIds.has(r.id)).map((r) => ({ id: r.id, name: r.name_en ?? "Room", polygon: r.polygon })));
  const rail = await loadProjectRail(projectId);
  const persona = rail?.persona ?? "owner";
  const stepDefs = (persona === "firm" ? FIRM_STEPS : OWNER_STEPS).map((s) => ({ key: s.key as string, name: `${s.number} ${s.label}` }));
  const blocked = check.pairs.length
    ? stepDefs.filter((s) => rail?.statuses[s.key]?.state === "blocked" && /overlap/i.test(rail?.statuses[s.key]?.reason ?? "")).map((s) => ({ step: s.name, reason: rail!.statuses[s.key]!.reason! }))
    : [];
  const eyebrow = stepEyebrow(persona, "scope", "plan", "Plan");
  const totalArea = plan.total_area_m2 ?? null;
  const unit = authored ? "zones" : "rooms";
  const meta = [
    `${roomList.length} ${unit} · ${formatM2(totalArea)}`,
    authored ? (plot ? `drawn on a ${plot.width_m} × ${plot.depth_m} m plot` : "drawn by you") : "parsed from the drawing",
    meanConfidencePct != null ? `${meanConfidencePct}% avg confidence` : null,
    correctionsTotal != null && correctionsTotal > 0 ? `${correctionsTotal} correction${correctionsTotal === 1 ? "" : "s"}` : null,
  ].filter(Boolean) as string[];
  const next =
    persona === "firm"
      ? { label: "Continue to 03 Specification", href: `/project/${projectId}/accessories` }
      : { label: "Continue to design", href: `/project/${projectId}/design` };

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8 pb-16 lg:px-10" data-plan-page>
      <p className="t-label-caps text-bp-brass-text">{eyebrow}</p>
      <h1 className="t-heading-lg mt-2 text-bp-ink-primary">{authored ? "Your plan, as you draw it" : "The plan, as parsed"}</h1>
      <p className="t-label-md mt-2 font-bp-mono text-bp-ink-secondary">{meta.join(" · ")}</p>

      {parsedComplete ? (
        <div className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0" aria-label="Plan editor">
            {/* The canvas sits on the sunken surface; its internals are the editor's own (K5: chrome only). */}
            <div className="border border-bp-line-hairline bg-bp-surface-sunken p-4">
              <PlanLayers
                projectId={projectId}
                planId={plan.id}
                initialRooms={roomList}
                initialTotalAreaM2={totalArea}
                areaDisputes={areaDisputes}
                overlaysEnabled={process.env.OVERLAYS_ENABLED === "true"}
                gardenPilot={gardenPilot}
                plot={plot}
                context={gardenSite?.context ?? []}
                siteRefs={gardenSite?.siteRefs}
                mode="edit"
              />
            </div>
            {gardenSite ? (
              <div className="mt-6">
                <AtelierCanvas>
                  <GardenSitePanel projectId={projectId} planId={plan.id} draft={gardenSite.draft} items={gardenSite.items} zones={gardenSite.zones} untypedCounters={gardenSite.untypedCounters} />
                </AtelierCanvas>
              </div>
            ) : null}
          </section>

          <div className="min-w-0 space-y-8">
            <PlanCheckPanel
              planId={plan.id}
              pairs={check.pairs}
              sentence={check.pairs.length ? planCheckSentence(check, totalArea) : null}
              canReparse={!authored && Boolean(plan.pdf_url)}
              blocked={blocked}
              summary={{ rooms: roomList.length, area: formatM2(totalArea), label: unit }}
            />

            <section aria-labelledby="rooms-h">
              <h2 id="rooms-h" className="t-label-caps text-bp-ink-tertiary">
                {roomList.length} {authored ? "ZONES DRAWN" : "ROOMS DETECTED"}
              </h2>
              <ul className="mt-2 max-h-[360px] overflow-y-auto" tabIndex={0} aria-label={authored ? "Zones" : "Rooms"}>
                {roomList.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 border-b border-bp-line-hairline py-2">
                    <span className="t-body-sm min-w-0 truncate text-bp-ink-primary">{r.name_en ?? "(unnamed)"}</span>
                    <span className="t-num-sm text-bp-ink-secondary">{formatM2(r.area_m2)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 grid grid-cols-3 gap-3">
                <div>
                  <dt className="t-label-caps text-bp-ink-tertiary">AREA</dt>
                  <dd className="t-num-md text-bp-ink-primary">{formatM2(totalArea)}</dd>
                </div>
                <div>
                  <dt className="t-label-caps text-bp-ink-tertiary">BEDROOMS</dt>
                  <dd className="t-num-md text-bp-ink-primary">{roomList.filter((r) => BEDROOM_TYPES.has(r.room_type ?? "")).length}</dd>
                </div>
                <div>
                  <dt className="t-label-caps text-bp-ink-tertiary">BATHROOMS</dt>
                  <dd className="t-num-md text-bp-ink-primary">{roomList.filter((r) => BATHROOM_TYPES.has(r.room_type ?? "")).length}</dd>
                </div>
              </dl>
            </section>

            {process.env.DRAWINGS_ENABLED === "true" || process.env.VIEWER_3D_ENABLED === "true" ? (
              <section aria-label="From this plan" className="flex flex-col items-start gap-3 border-t border-bp-line-hairline pt-4">
                {process.env.DRAWINGS_ENABLED === "true" ? (
                  <Button kind="quiet" href={`/project/${projectId}/drawings`}>
                    <Icon name="draft" size={18} /> Open the drawings
                  </Button>
                ) : null}
                {process.env.VIEWER_3D_ENABLED === "true" ? (
                  <Button kind="quiet" href={`/project/${projectId}/viewer`}>
                    <Icon name="view_in_ar" size={18} /> Walk your villa in 3D
                  </Button>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <AtelierCanvas>
            <PlanNotAnalysed planId={plan.id} hasDrawing={Boolean(plan.pdf_url)} parseRan={plan.parsed_json !== null} canDraw={gardenPilot} />
          </AtelierCanvas>
        </div>
      )}

      {parsedComplete ? (
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-bp-line-hairline pt-5">
          <Button kind="secondary" href={authored ? "/projects" : "/project/new"}>
            {authored ? "Back to projects" : "Back to upload"}
          </Button>
          <Button kind="primary" href={next.href}>
            {next.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
