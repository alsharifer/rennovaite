import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { z } from "zod";

import { StateBlock } from "@/components/blueprint/StateBlock";
import { getPageCaller } from "@/lib/auth/caller";
import { StoreError } from "@/lib/firms/store";
import { reviewQuote, type LineReview, type Quote, type QuoteLine } from "@/lib/quotes/store";
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
  const caller = await getPageCaller();
  if (!caller) {
    return (
      <>
        <div className="mx-auto max-w-4xl px-6 py-8">
          <SignInCard what="this quotation" />
        </div>
      </>
    );
  }
  let quote: Quote;
  let lines: (QuoteLine & LineReview)[];
  try {
    // H8: each line with the entry it would replace and any converted-rate offer.
    ({ quote, lines } = await reviewQuote(getSupabaseAdmin() as unknown as SupabaseClient, firmId, quoteId, caller));
  } catch (e) {
    if (e instanceof StoreError && e.status === 404) notFound();
    if (e instanceof StoreError && e.status === 403) {
      return (
        <>
          <div className="mx-auto max-w-[720px] px-6 py-8">
            <StateBlock kind="gate" title="Members only">
              A quotation is visible to the firm&rsquo;s members and to nobody else.
            </StateBlock>
          </div>
        </>
      );
    }
    throw e;
  }
  return (
    <>
      <QuoteReview firmId={firmId} initialQuote={quote} initialLines={lines} />
    </>
  );
}
