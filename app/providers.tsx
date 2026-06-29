"use client";

import posthog from "posthog-js";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

// PostHog config. The key is the on/off switch: when it's absent (local dev,
// the demo, CI) the provider initialises nothing and every analytics call
// no-ops, so there are no network calls and no console noise.
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

// Module-scoped guard so React strict-mode's double-effect (and HMR) don't
// re-init the singleton.
let didInit = false;

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!POSTHOG_KEY || !didInit) return;
    let url = window.location.origin + pathname;
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY || didInit) return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // We capture pageviews manually in PageviewTracker so App Router
      // client-side navigations are counted (PostHog's auto-capture only
      // sees the first hard load).
      capture_pageview: false,
      capture_pageleave: true,
      // Only create person profiles once we posthog.identify() a real user;
      // anonymous funnel events still flow under an anonymous distinct_id.
      person_profiles: "identified_only",
    });
    didInit = true;
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </>
  );
}
