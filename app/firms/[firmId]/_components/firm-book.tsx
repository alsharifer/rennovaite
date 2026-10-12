import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

import { BasisControl } from "@/components/blueprint/book/BasisControl";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { getPageCaller } from "@/lib/auth/caller";
import { loadBookView, type BookView } from "@/lib/firms/book-view";
import { StoreError } from "@/lib/firms/store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { SignInCard } from "../../_components/sign-in-card";
import { FirmBookEditor } from "./firm-book-editor";

// U2 / K4 — one firm's rate book (Rates & Basis, R7 §3.3), for its members.
// Rendered by /firms/[firmId] and, in a project's journey, by
// /project/[id]/rates (step 04) with that project's context — one component,
// so both read the book the same way.
//
// The view is read through the store with the caller (loadBookView starts with
// the member check), so a non-member gets the 403 block here and never a byte
// of the book; the editor then talks to /api/firms/:firmId/* for every change.

export async function FirmBook({ firmId, projectId = null, startAdding = false }: { firmId: string; projectId?: string | null; startAdding?: boolean }) {
  const caller = await getPageCaller();
  if (!caller) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <SignInCard what="this rate book" />
      </div>
    );
  }
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  let view: BookView;
  try {
    view = await loadBookView(db, firmId, caller, projectId);
  } catch (e) {
    if (e instanceof StoreError && e.status === 404) notFound();
    if (e instanceof StoreError && e.status === 403) {
      return (
        <div className="mx-auto max-w-[720px] px-6 py-8">
          <StateBlock kind="gate" title="Members only">
            A rate book is visible to the firm&rsquo;s members and to nobody else. Ask a member to add your account.
          </StateBlock>
        </div>
      );
    }
    throw e;
  }
  return (
    <FirmBookEditor
      initialFirm={view.firm}
      view={view}
      startAdding={startAdding}
      basisControl={view.project ? <BasisControl projectId={view.project.id} boqId={view.project.boqId} rev={view.project.rev} status={view.project.basis} acceptedOn={view.project.acceptedOn} /> : null}
    />
  );
}
