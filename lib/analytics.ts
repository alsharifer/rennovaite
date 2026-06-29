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
