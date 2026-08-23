import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PropertyOsLanding } from "@/app/_components/property-os-landing";
import { HomeLanding } from "@/components/marketing/home-landing";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Read-at-server-start flag (documented in CLAUDE.md). OFF → `/` behaves exactly
// as before (the RennovAIte marketing home). ON → `/` is the Property OS intro
// for visitors; signed-in users go straight to their portal.
// Render per request so the server-start flag + the signed-in redirect are
// honoured at runtime (a statically-baked `/` would freeze the flag at build).
export const dynamic = "force-dynamic";

const propertyOsEnabled = () => process.env.PROPERTY_OS_LANDING === "true";

// Where a signed-in visitor to `/` is sent — the same destination the auth
// callback defaults to (app/auth/callback/route.ts). Not new auth logic.
const SIGNED_IN_PORTAL = "/project";

export async function generateMetadata(): Promise<Metadata> {
  if (!propertyOsEnabled()) return {}; // inherit the root layout default (as today)
  const title = "Property OS — by RennovAIte";
  const description =
    "Design, price, and deliver work on your property — starting with RennovAIte, Dubai's calibrated AI renovation platform.";
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RootPage() {
  // Flag off → unchanged: the existing marketing homepage at `/`.
  if (!propertyOsEnabled()) return <HomeLanding />;

  // Flag on → auth-aware: signed-in users skip the intro and land in the portal.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(SIGNED_IN_PORTAL);

  return <PropertyOsLanding />;
}
