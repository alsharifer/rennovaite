import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase-admin.ts must only be imported from server code — it uses the service-role key.",
  );
}

type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | null = null;

function build(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local and restart the dev server.",
    );
  }
  cached ??= createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function getSupabaseAdmin(): AdminClient {
  return build();
}

export const supabaseAdmin = new Proxy({} as AdminClient, {
  get(_target, prop, receiver) {
    return Reflect.get(build(), prop, receiver);
  },
});
