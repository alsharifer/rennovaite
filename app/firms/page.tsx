import type { SupabaseClient } from "@supabase/supabase-js";

import { redirect } from "next/navigation";

import { RateBooksList, type RateBookRow } from "@/components/blueprint/book/RateBooksList";
import { AccountShell } from "@/components/blueprint/shell/ProjectShell";
import { revDate } from "@/components/blueprint/shell/rev-line";
import { getCaller } from "@/lib/auth/caller";
import { getFirmSummary, listFirms, type Firm } from "@/lib/firms/store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { SignInCard } from "./_components/sign-in-card";

export const dynamic = "force-dynamic";

// /firms — the caller's firms (never anyone else's).
//
// K2 (spec §3.10): a member of exactly one firm goes straight to its book; the
// list stays for none (create one) or several. K8 #10 (spec §6.8, 63:1094):
// the list is Blueprint — each firm's active entries, its review state and
// its last quote import. A signed-out visit is turned away by the proxy; the
// sign-in card is the backstop.
export default async function FirmsPage() {
  const caller = await getCaller();
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  let firms: Firm[] = [];
  if (caller) firms = await listFirms(db, caller);
  if (firms.length === 1) redirect(`/firms/${firms[0]!.id}`);

  const rows: RateBookRow[] = await Promise.all(
    firms.map(async (f) => {
      const [summary, lastQuote] = await Promise.all([
        getFirmSummary(db, f.id, caller),
        db
          .from("firm_quotes")
          .select("id, created_at")
          .eq("firm_id", f.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<{ id: string; created_at: string }>()
          .then((r) => r.data, () => null),
      ]);
      let lastImport: string | null = null;
      if (lastQuote) {
        const { count } = await db.from("firm_quote_lines").select("id", { count: "exact", head: true }).eq("quote_id", lastQuote.id);
        lastImport = `${revDate(lastQuote.created_at)}${count != null ? ` · ${count} line${count === 1 ? "" : "s"}` : ""}`;
      }
      return {
        id: f.id,
        name: f.name,
        entries: summary.entry_count,
        reviewed: summary.status === "reviewed" && summary.reviewed_at ? revDate(summary.reviewed_at) : null,
        lastImport,
      };
    }),
  );

  return (
    <AccountShell>
      <div className="mx-auto max-w-[1344px] px-6 pb-16 pt-8 lg:px-12">{caller ? <RateBooksList rows={rows} /> : <SignInCard what="your firms" />}</div>
    </AccountShell>
  );
}
