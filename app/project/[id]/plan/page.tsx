import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/blueprint/Button";
import { Icon } from "@/components/blueprint/Icon";
import { OpeningsCheckPanel } from "@/components/blueprint/plan/OpeningsCheckPanel";
import { PlanCheckPanel } from "@/components/blueprint/plan/PlanCheckPanel";
import type { DetectionRun } from "@/lib/plan/openings-vocab";
import { floorCoverage, readingFloorEstimate } from "@/lib/plan/coverage";
import { stepIssues } from "@/lib/boq/issues";
import { PlanRulesNavigator, PlanRulesPanel } from "@/components/blueprint/plan/PlanRules";
import { planRuleIssues } from "@/lib/plan/plan-issues";
import { checkPlan, metresPerUnit, type RuleOpening } from "@/lib/plan/plan-rules";
import { matchPrintedSizes, planM2PerUnit2, printedSizeCheck, printedSizesFromParsedJson } from "@/lib/plan/printed-sizes";
import { PlanRoomFocus } from "@/components/blueprint/plan/PlanRoomFocus";
import { loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
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
import { planGate } from "@/lib/plan/plan-gate";
import { RoomsInScope } from "@/components/blueprint/plan/RoomsInScope";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string; layer?: string }>;
}) {
  const { id: projectId } = await params;
  const { room: focusRoomId, layer: initialLayer } = await searchParams;
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
  // K12: in_scope (058) first; a database without it falls back to the 025/031 columns.
  let withConf = await sb
    .from("rooms")
    .select("id, name_en, name_ar, room_type, area_m2, polygon, confidence, unroofed, in_scope")
    .eq("plan_id", plan.id)
    .order("name_en")
    .returns<RawRoomInput[]>();
  if (withConf.error) {
    withConf = await sb
      .from("rooms")
      .select("id, name_en, name_ar, room_type, area_m2, polygon, confidence, unroofed")
      .eq("plan_id", plan.id)
      .order("name_en")
      .returns<RawRoomInput[]>();
  }
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
  // K10 #4: the editor opens whenever the plan has rooms — the SAME list the header counts
  // (roomList) — or is authored. A parse record is not required: the Demo villa has 13 rooms
  // and no parsed_json, and used to read "No drawing attached".
  const planReady = planGate({ authored, roomCount: roomList.length }) === "editor";
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

  // R10b (059): openings found on the drawing — when detection ran, and how it went.
  // Best-effort: before 059 the panel simply starts no run.
  const detectRes = await planSb.from("plans").select("openings_detected_at, openings_detection").eq("id", plan.id).maybeSingle<{ openings_detected_at: string | null; openings_detection: DetectionRun | null }>();
  const detection = detectRes.error ? null : detectRes.data;
  const canDetect = !authored && Boolean(plan.pdf_url) && !detectRes.error;
  const totalArea = plan.total_area_m2 ?? null;
  const unit = authored ? "zones" : "rooms";
  // 15 Oct: the plan rules (lib/plan/plan-rules.ts) — the same checks the editor
  // refuses on, listed here and in the top bar's navigator with the step's reason.
  const [openingsRes, roomSpecRes] = await Promise.all([
    planSb.from("plan_openings").select("id, kind, width_mm, height_mm, sill_mm, position, room_id, source, detection, spec, context_id").eq("plan_id", plan.id),
    planSb.from("rooms").select("id, spec").eq("plan_id", plan.id),
  ]);
  const roomSpecs = new Map(((roomSpecRes.error ? [] : roomSpecRes.data) ?? []).map((r: { id: string; spec: Record<string, unknown> | null }) => [r.id, r.spec]));
  const ruleMPerU = metresPerUnit(roomList, totalArea, authored ? plot?.width_m ?? null : null);
  const ruleCheck = ruleMPerU
    ? checkPlan({
        rooms: roomList.filter((r) => !removedIds.has(r.id)).map((r) => ({ ...r, spec: roomSpecs.get(r.id) ?? null })),
        openings: (openingsRes.error ? [] : (openingsRes.data ?? [])) as RuleOpening[],
        mPerU: ruleMPerU,
      })
    : null;
  const ruleViolations = ruleCheck?.violations ?? [];
  const planStepKey = persona === "firm" ? "scope" : "plan";
  const planStepLabel = stepDefs.find((s) => s.key === planStepKey)?.name ?? "Plan";
  const ruleIssues = planRuleIssues(ruleViolations, stepIssues(rail?.statuses[planStepKey] ?? null, planStepLabel));
  // 15 Oct: rooms against the size the sheet prints — flagged past 10% at the
  // plan's own metre scale; Fix overlaps trims the room further over it.
  const printedById = authored ? new Map<string, number>() : matchPrintedSizes(roomList, printedSizesFromParsedJson(plan.parsed_json));
  const printedFlags = printedSizeCheck(
    roomList.filter((r) => !removedIds.has(r.id)),
    printedById,
    planM2PerUnit2(roomList, totalArea),
  );
  const meta = [
    `${roomList.length} ${unit} · ${formatM2(totalArea)}`,
    // K10: say where the rooms came from — never "parsed from the drawing" when there is no drawing.
    authored ? (plot ? `drawn on a ${plot.width_m} × ${plot.depth_m} m plot` : "drawn by you") : plan.pdf_url ? "parsed from the drawing" : "no drawing attached",
    meanConfidencePct != null ? `${meanConfidencePct}% avg confidence` : null,
    correctionsTotal != null && correctionsTotal > 0 ? `${correctionsTotal} correction${correctionsTotal === 1 ? "" : "s"}` : null,
  ].filter(Boolean) as string[];
  const next =
    persona === "firm"
      ? { label: "Continue to 03 Specification", href: `/project/${projectId}/accessories` }
      : { label: "Continue to design", href: `/project/${projectId}/design` };

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8 pb-16 lg:px-10" data-plan-page>
      {focusRoomId ? <PlanRoomFocus roomId={focusRoomId} /> : null}
      <PlanRulesNavigator planId={plan.id} issues={ruleIssues} violations={ruleViolations} />
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
                initialLayer={initialLayer ?? null}
                printedSizes={Object.fromEntries(printedById)}
                mode="edit"
              />
            </div>
            {gardenSite ? (
              <div className="mt-6">
                <GardenSitePanel projectId={projectId} planId={plan.id} draft={gardenSite.draft} items={gardenSite.items} zones={gardenSite.zones} untypedCounters={gardenSite.untypedCounters} />
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
              coverage={authored ? null : floorCoverage(roomList, readingFloorEstimate(plan.parsed_json))}
              printed={printedFlags}
            />

            <PlanRulesPanel planId={plan.id} violations={ruleViolations} />

            {/* R10b (§7.5): "We found 2 windows and an opening to the kitchen — correct?" */}
            {!authored ? (
              <OpeningsCheckPanel
                planId={plan.id}
                rooms={roomList.map((r) => ({ id: r.id, name: r.name_en ?? "Room" }))}
                canDetect={canDetect}
                detectedAt={detection?.openings_detected_at ?? null}
                run={detection?.openings_detection ?? null}
              />
            ) : null}

            <section aria-label="This renovation">
              {/* K12 (§7.4, 81:716): which rooms this renovation covers — everything after this step follows it. */}
              <RoomsInScope planId={plan.id} zones={authored} rooms={roomList.map((r) => ({ id: r.id, name: r.name_en ?? "(unnamed)", area_m2: r.area_m2, in_scope: r.in_scope !== false }))} />
              <dl className="mt-4 grid grid-cols-3 gap-3">
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
          <PlanNotAnalysed planId={plan.id} hasDrawing={Boolean(plan.pdf_url)} parseRan={plan.parsed_json !== null} canDraw={gardenPilot} />
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
