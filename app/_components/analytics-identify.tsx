"use client";

import { useEffect } from "react";

import { identify } from "@/lib/analytics";

/**
 * Identifies the signed-in user to PostHog so funnel events attribute to a
 * real person instead of an anonymous distinct_id. Rendered (server-side) only
 * when there's a session; no-ops when analytics is off. Renders nothing.
 */
export function AnalyticsIdentify({
  distinctId,
  email,
  name,
}: {
  distinctId: string;
  email?: string | null;
  name?: string | null;
}) {
  useEffect(() => {
    identify(distinctId, {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
    });
  }, [distinctId, email, name]);

  return null;
}
