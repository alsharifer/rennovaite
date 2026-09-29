import { NextResponse } from "next/server";

import { getCaller } from "@/lib/auth/caller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reports which env vars are wired up on this deployment without leaking
// values. Hit this on the live URL to verify Vercel's env config without
// clicking through the dashboard:
//
//   curl https://<your-domain>/api/health
//
// `present: true` means the var is set to a non-empty string. The route
// also reports the Vercel context (preview / production / unknown) so you
// can tell whether you're hitting the right environment scope.
// (NB: folder is `health`, not `_health` — App Router treats
// underscore-prefixed folders as private and excludes them from routing.)
//
// H1: public (lib/auth/access.ts) so an uptime check needs no session — but an
// anonymous caller gets presence only. The fingerprints, however partial, are
// pieces of secrets; they are for a signed-in caller.
export async function GET(request: Request) {
  const signedIn = !!(await getCaller(request));
  const vars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "REPLICATE_API_TOKEN",
    "NEXT_PUBLIC_POSTHOG_KEY",
  ] as const;

  const env = Object.fromEntries(
    vars.map((name) => [
      name,
      {
        present: typeof process.env[name] === "string" && process.env[name] !== "",
        // Cheap fingerprint: first 6 + last 4 chars, length. Helps catch
        // "I pasted the wrong value" without leaking the secret.
        ...(signedIn ? { fingerprint: fingerprint(process.env[name]) } : {}),
      },
    ]),
  );

  return NextResponse.json({
    ok: true,
    vercel_env: process.env.VERCEL_ENV ?? "unknown",
    vercel_url: process.env.VERCEL_URL ?? null,
    node: process.version,
    signed_in: signedIn,
    env,
  });
}

function fingerprint(value: string | undefined): string | null {
  if (!value) return null;
  const len = value.length;
  if (len < 12) return `len=${len}`;
  return `${value.slice(0, 6)}…${value.slice(-4)} (len=${len})`;
}
