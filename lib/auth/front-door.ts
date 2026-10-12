// =============================================================================
// lib/auth/front-door.ts — the sign-in page is the front door (13 Oct).
//
// While the pilot is invite-only there is no public landing: `/` and
// `/rennovaite` (the Property OS intro and the old HomeLanding) are unrouted,
// and both answer with a TEMPORARY redirect (Next's `redirect()` = 307):
//
//   signed out → /auth
//   signed in  → postSignInPath() — the same rule the auth callback and /auth use
//
// Never a permanent redirect: browsers cache a 308, and a landing page may
// come back after the pilot. No loop: /auth renders for a signed-out visitor
// and itself sends a signed-in one to postSignInPath(), never back to `/`.
// =============================================================================

import { redirect } from "next/navigation";

import { getPageCaller } from "@/lib/auth/caller";
import { SIGNED_IN_HOME, postSignInPath } from "@/lib/auth/link-error";

export const FRONT_DOOR = "/auth";

/** Redirects every visit; never returns. */
export async function frontDoorRedirect(): Promise<never> {
  redirect((await getPageCaller()) ? postSignInPath() : FRONT_DOOR);
}

/** A URL's search params back as a query string ("" when none) — redirects keep them. */
export function queryString(sp: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v != null) qs.set(k, v);
  }
  const q = qs.toString();
  return q ? `?${q}` : "";
}

/**
 * K8 (spec §6.1): /dashboard, /my-projects and /project are the Projects home
 * now — a temporary redirect that keeps the query (filters, sort, view).
 */
export async function redirectToProjectsHome(searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<never> {
  redirect(`${SIGNED_IN_HOME}${queryString(await searchParams)}`);
}
