import { frontDoorRedirect } from "@/lib/auth/front-door";

// Was the RenovAIte marketing homepage (HomeLanding, parked — K_BACKLOG). While
// the pilot is invite-only it redirects exactly like `/` (lib/auth/front-door.ts).
export const dynamic = "force-dynamic";

export default async function RennovaitePage() {
  return frontDoorRedirect();
}
