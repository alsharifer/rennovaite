import { frontDoorRedirect } from "@/lib/auth/front-door";

// The front door is /auth while the pilot is invite-only (lib/auth/front-door.ts):
// signed out → /auth, signed in → the post-sign-in home, both 307. The Property
// OS intro (app/_components/property-os-landing.tsx) and HomeLanding are parked,
// not deleted — K_BACKLOG.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  return frontDoorRedirect();
}
