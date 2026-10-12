import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PropertyOsLanding } from "@/app/_components/property-os-landing";
import { HomeLanding } from "@/components/marketing/home-landing";
import { getPageCaller } from "@/lib/auth/caller";
import { SIGNED_IN_HOME } from "@/lib/auth/link-error";

// Read-at-server-start flag (documented in CLAUDE.md). OFF → `/` is the
// RenovAIte marketing home for visitors. ON → `/` is the Property OS intro for
// visitors. Either way a signed-in user goes straight to their portal — with the
// flag off they used to land back on the marketing page after signing in and be
// asked to sign in again.
// Render per request so the server-start flag + the signed-in redirect are
// honoured at runtime (a statically-baked `/` would freeze the flag at build).
export const dynamic = "force-dynamic";

const propertyOsEnabled = () => process.env.PROPERTY_OS_LANDING === "true";


export async function generateMetadata(): Promise<Metadata> {
  if (!propertyOsEnabled()) return {}; // inherit the root layout default (as today)
  const title = "Property OS — by RenovAIte";
  const description =
    "Design, price, and deliver work on your property — starting with RenovAIte, Dubai's calibrated AI renovation platform.";
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RootPage() {
  // Signed-in users skip the landing and go to the portal — the same
  // destination the auth callback defaults to (SIGNED_IN_HOME).
  if (await getPageCaller()) redirect(SIGNED_IN_HOME);

  // R7 §1.8: the owner landing wears the warm skin. A layout-neutral wrapper,
  // so /rennovaite (the same HomeLanding) stays exactly as it was.
  return (
    <div data-skin="warm" className="contents">
      {propertyOsEnabled() ? <PropertyOsLanding /> : <HomeLanding />}
    </div>
  );
}
