import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppShell } from "@/components/app/AppShell";
import { getCaller } from "@/lib/auth/caller";
import { StoreError } from "@/lib/firms/store";
import { getQuote, type Quote, type QuoteLine } from "@/lib/quotes/store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { SignInCard } from "../../../_components/sign-in-card";
import { QuoteReview } from "./_components/quote-review";

export const dynamic = "force-dynamic";

// U3 — /firms/:firmId/quotes/:quoteId: review a quotation line by line.
// Same shape as the book page: the first render reads through the store with
// the caller; a non-member gets the card, never a line.

export default async function QuoteReviewPage({ params }: { params: Promise<{ firmId: string; quoteId: string }> }) {
  const { firmId, quoteId } = await params;
  if (!z.string().uuid().safeParse(firmId).success || !z.string().uuid().safeParse(quoteId).success) notFound();
  const caller = await getCaller();
  if (!caller) {
    return (
      <AppShell pageName="Quotation">
        <div className="mx-auto max-w-4xl">
          <SignInCard what="this quotation" />
        </div>
      </AppShell>
    );
  }
  let quote: Quote;
  let lines: QuoteLine[];
  try {
    ({ quote, lines } = await getQuote(getSupabaseAdmin() as unknown as SupabaseClient, firmId, quoteId, caller));
  } catch (e) {
    if (e instanceof StoreError && e.status === 404) notFound();
    if (e instanceof StoreError && e.status === 403) {
      return (
        <AppShell pageName="Quotation">
          <div className="mx-auto max-w-4xl">
            <section className="rounded-xl border border-ink-100 bg-paper p-lg" aria-label="Not a member">
              <p className="label-caps text-ink-500">Members only</p>
              <h2 className="mt-xs font-display text-headline-md text-ink-900">You are not a member of this firm</h2>
            </section>
          </div>
        </AppShell>
      );
    }
    throw e;
  }
  return (
    <AppShell pageName="Quotation">
      <div className="mx-auto max-w-6xl">
        <QuoteReview firmId={firmId} initialQuote={quote} initialLines={lines} />
      </div>
    </AppShell>
  );
}
