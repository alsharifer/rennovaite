import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";

/**
 * Cookie-aware Supabase client for the App Router.
 *
 * - In Route Handlers and Server Actions, `setAll` can write cookies, so the
 *   auth session is persisted (used by /auth/callback's exchange).
 * - In Server Components, cookie writes throw; we swallow that — the session
 *   is refreshed by the next route handler / action instead.
 *
 * Uses the public anon key (Auth runs as the end user, never the service
 * role). lib/supabase.ts and lib/supabase-admin.ts remain for data access.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart.",
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — safe to ignore.
        }
      },
    },
  });
}
