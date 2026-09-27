import type { SupabaseClient } from "@supabase/supabase-js";

import { AppShell } from "@/components/app/AppShell";
import { getCaller } from "@/lib/auth/caller";
import { listFirms, type Firm } from "@/lib/firms/store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { FirmList } from "./_components/firm-list";
import { SignInCard } from "./_components/sign-in-card";

export const dynamic = "force-dynamic";

// U2 — /firms: the caller's firms (never anyone else's) and a way to create one.
// A signed-out visitor sees a sign-in card, not a redirect: there is no
// middleware in this app (docs/AUTH.md), and a page that renders nothing
// useful is worse than one that says why.
export default async function FirmsPage() {
  const caller = await getCaller();
  let firms: Firm[] = [];
  if (caller) firms = await listFirms(getSupabaseAdmin() as unknown as SupabaseClient, caller);
  return (
    <AppShell pageName="Rate books">
      <div className="mx-auto max-w-4xl">
        <header className="mb-lg">
          <p className="label-caps text-ink-500">Firms</p>
          <h1 className="font-display text-headline-lg text-ink-900">Rate books</h1>
          <p className="mt-xs max-w-2xl text-body-md text-ink-700">
            A firm&rsquo;s private book shadows the market reference for that firm&rsquo;s projects only. Its rates reach a BoQ line as
            &ldquo;contractor rate book&rdquo; — never as the firm&rsquo;s name — and its overheads &amp; profit are applied once, as a
            visible line, never inside a rate.
          </p>
        </header>
        {caller ? <FirmList initialFirms={firms} callerEmail={caller.email} /> : <SignInCard what="your firms" />}
      </div>
    </AppShell>
  );
}
