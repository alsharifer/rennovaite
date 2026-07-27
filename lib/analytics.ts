// One analytics entry point for the whole app.
//
// `track` is safe to import and call from anywhere — it no-ops on the server
// and no-ops on the client when PostHog isn't configured (no key). All funnel
// events go through here so the event vocabulary stays in one typed place.
import posthog from "posthog-js";

/**
 * The pilot conversion funnel, in order. Values are the wire event names —
 * keep them stable, dashboards/insights key off these strings.
 */
export enum AnalyticsEvent {
  ProjectStarted = "project_started",
  PlanParsed = "plan_parsed",
  StyleSelected = "style_selected",
  RenderGenerated = "render_generated",
  RenderIterated = "render_iterated",
  BoqGenerated = "boq_generated",
  VendorSwapped = "vendor_swapped",
  SentToContractor = "sent_to_contractor",
  // Render pipeline (Phase 3) — fired server-side from the render routes.
  RenderStarted = "render_started",
  RenderCompleted = "render_completed",
  RenderQaFailed = "render_qa_failed",
  RenderTweaked = "render_tweaked",
}

export function track(
  event: AnalyticsEvent,
  props?: Record<string, unknown>,
): void {
  // No-op on the server (server actions / route handlers can import this).
  if (typeof window === "undefined") return;
  // No-op when PostHog isn't configured — keeps local dev + the demo clean.
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.capture(event, props);
}

/**
 * Attribute subsequent events to a real person. Called once after login with
 * the Supabase user. No-ops when analytics is off.
 */
export function identify(
  distinctId: string,
  props?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.identify(distinctId, props);
}

/**
 * Server-side event capture for route handlers (the browser `track()` no-ops on
 * the server). Fires the same PostHog project; no-ops without a key. Defaults
 * the distinct id to the project so render events group per project.
 */
export async function trackServer(
  event: AnalyticsEvent,
  props: { projectId: string } & Record<string, unknown>,
): Promise<void> {
  const { projectId, ...rest } = props;
  await captureServer(event, `project:${projectId}`, {
    project_id: projectId,
    ...rest,
  });
}

// =============================================================================
// Feedback capture — the KG feedback-loop substrate.
// =============================================================================

export type FeedbackEntityType =
  | "render"
  | "boq_line"
  | "vendor"
  | "style"
  | "plan";

export type FeedbackAction =
  | "accepted"
  | "rejected"
  | "iterated"
  | "swapped"
  | "edited";

export type RecordFeedbackArgs = {
  projectId: string;
  entityType: FeedbackEntityType;
  entityId: string;
  action: FeedbackAction;
  /** The KG bundle that produced the entity (from renders/boqs.kg_bundle_id). */
  kgBundleId?: string | null;
  /** Before/after detail — tweak text, {from,to,delta_aed}, etc. */
  payload?: Record<string, unknown>;
  userId?: string | null;
  /** PostHog distinct_id; defaults to the user, else the project. */
  distinctId?: string | null;
};

// Server-side PostHog capture. The client `track()` no-ops on the server
// (posthog-js needs the browser), so feedback fired from route handlers reaches
// PostHog through the ingest API instead. Same project key, same destination —
// it just lands via HTTP rather than the browser SDK. No-ops without a key.
async function captureServer(
  event: string,
  distinctId: string,
  props: Record<string, unknown>,
): Promise<void> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties: props,
      }),
      // Never let analytics hold up (or fail) the request that triggered it.
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[analytics] captureServer failed:", err);
  }
}

/**
 * Record one user feedback signal in BOTH stores: a `feedback_events` row (the
 * durable substrate the KG reweighting job will read) and PostHog (for live
 * product analytics). Server-only — uses the admin client. Fail-soft: a missing
 * table or a network blip is logged, never thrown, so the demo never breaks.
 */
export async function recordFeedback(args: RecordFeedbackArgs): Promise<void> {
  if (typeof window !== "undefined") {
    // Guard: this is the server twin of track(). Client capture points POST to
    // /api/feedback, which calls this on the server.
    console.warn("[analytics] recordFeedback called on the client — skipped.");
    return;
  }

  const distinctId =
    args.distinctId ?? args.userId ?? `project:${args.projectId}`;

  // 1. Durable store — feedback_events via the admin client.
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase-admin");
    const { error } = await getSupabaseAdmin()
      .from("feedback_events")
      .insert({
        project_id: args.projectId,
        user_id: args.userId ?? null,
        entity_type: args.entityType,
        entity_id: args.entityId,
        action: args.action,
        kg_bundle_id: args.kgBundleId ?? null,
        payload: (args.payload ?? {}) as never,
      });
    if (error) {
      console.warn("[analytics] feedback_events insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[analytics] recordFeedback insert error:", err);
  }

  // 2. PostHog — same signal, both stores.
  await captureServer("feedback_captured", distinctId, {
    entity_type: args.entityType,
    entity_id: args.entityId,
    action: args.action,
    kg_bundle_id: args.kgBundleId ?? null,
    project_id: args.projectId,
    ...(args.payload ?? {}),
  });
}
