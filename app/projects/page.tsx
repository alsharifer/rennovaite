import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AnalyticsIdentify } from "@/app/_components/analytics-identify";
import { ProjectsHome } from "@/components/blueprint/home/ProjectsHome";
import { getPageCaller } from "@/lib/auth/caller";
import { listFirms } from "@/lib/firms/store";
import { loadProjectsHome } from "@/lib/projects/home-view";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata: Metadata = { title: "Projects · RenovAIte" };
export const dynamic = "force-dynamic";

// K8 #1 — the Projects home (spec §6.1, Figma 53:65 · phone 66:1343): the page
// after sign-in. /dashboard, /my-projects and /project redirect here. Every
// figure and reason on it is a stored one or the rail's own (lib/projects/
// home-view.ts).
export default async function ProjectsPage() {
  const caller = await getPageCaller();
  if (!caller) redirect("/auth?next=/projects");
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const [view, firms] = await Promise.all([loadProjectsHome(db, caller), listFirms(db, caller).catch(() => [])]);
  // eslint-disable-next-line react-hooks/purity -- the request time, read once on the server for the ages
  const now = Date.now();
  return (
    <>
      <AnalyticsIdentify distinctId={caller.id} email={caller.email ?? undefined} />
      <Suspense fallback={null}>
        <ProjectsHome view={view} persona={firms.length > 0 ? "firm" : "owner"} now={now} />
      </Suspense>
    </>
  );
}
