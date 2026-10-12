import { redirect } from "next/navigation";

import { SIGNED_IN_HOME } from "@/lib/auth/link-error";

// K8: cut from navigation since K2 (spec §3.10) and given no frame in J6 — every
// authenticated page renders the Blueprint shell, and a "coming soon" page has
// nothing to put in it. Temporary, so the route can come back.
export default function Page() {
  redirect(SIGNED_IN_HOME);
}
