import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppShell } from "@/components/app/AppShell";
import { getCaller } from "@/lib/auth/caller";
import { StoreError, getFirmSummary, listEntries, type FirmSummary } from "@/lib/firms/store";
import type { FirmRateEntry } from "@/lib/rates/firm";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { SignInCard } from "../_components/sign-in-card";
import { FirmBookEditor } from "./_components/firm-book-editor";

export const dynamic = "force-dynamic";

// U2 — /firms/:firmId: one firm's rate book, for its members.
//
// The first render reads through the SAME store functions the API uses, with
// the same caller, so a non-member gets the 403 card here and never a byte of
// the book; the editor then talks to /api/firms/:firmId/* for every change.

export default async function FirmBookPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  if (!z.string().uuid().safeParse(firmId).success) notFound();
  const caller = await getCaller();
  if (!caller) {
    return (
      <AppShell pageName="Rate book">
        <div className="mx-auto max-w-4xl">
          <SignInCard what="this rate book" />
        </div>
      </AppShell>
    );
  }
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  let firm: FirmSummary;
  let entries: FirmRateEntry[];
  try {
    firm = await getFirmSummary(db, firmId, caller);
    entries = await listEntries(db, firmId, caller);
  } catch (e) {
    if (e instanceof StoreError && e.status === 404) notFound();
    if (e instanceof StoreError && e.status === 403) {
      return (
        <AppShell pageName="Rate book">
          <div className="mx-auto max-w-4xl">
            <section className="rounded-xl border border-ink-100 bg-paper p-lg" aria-label="Not a member">
              <p className="label-caps text-ink-500">Members only</p>
              <h2 className="mt-xs font-display text-headline-md text-ink-900">You are not a member of this firm</h2>
              <p className="mt-sm max-w-xl text-body-md text-ink-700">
                A rate book is visible to the firm&rsquo;s members and to nobody else. Ask a member to add your account.
              </p>
            </section>
          </div>
        </AppShell>
      );
    }
    throw e;
  }
  return (
    <AppShell pageName="Rate book">
      <div className="mx-auto max-w-6xl">
        <FirmBookEditor initialFirm={firm} initialEntries={entries} />
      </div>
    </AppShell>
  );
}
