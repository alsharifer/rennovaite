"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * End the magic-link session (U1 — the minimum session plumbing a membership
 * model needs: a way to stop being someone). Clears the auth cookies through
 * the SSR client and lands on the sign-in page.
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/auth");
}
