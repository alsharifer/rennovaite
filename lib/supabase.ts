import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

type Client = SupabaseClient<Database>;

let cached: Client | null = null;

function build(): Client {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart the dev server.",
    );
  }
  cached ??= createClient<Database>(url, anonKey);
  return cached;
}

export function getSupabaseClient(): Client {
  return build();
}

export const supabase = new Proxy({} as Client, {
  get(_target, prop, receiver) {
    return Reflect.get(build(), prop, receiver);
  },
});
