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
import { postSignInPath } from "@/lib/auth/link-error";

export const FRONT_DOOR = "/auth";

/** Redirects every visit; never returns. */
export async function frontDoorRedirect(): Promise<never> {
  redirect((await getPageCaller()) ? postSignInPath() : FRONT_DOOR);
}
