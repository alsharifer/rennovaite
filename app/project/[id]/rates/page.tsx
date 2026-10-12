import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";

import { Button } from "@/components/blueprint/Button";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { FirmBook } from "@/app/firms/[firmId]/_components/firm-book";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata: Metadata = { title: "Rates & Basis · RenovAIte" };
export const dynamic = "force-dynamic";

// K2 — firm step 04 Rates & Basis: the project's firm's rate book, in the
// project's journey. The SAME component as /firms/[firmId] (same store reads,
// same member check — a non-member gets its 403 card), framed by the project rail.
export default async function ProjectRatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getSupabaseAdmin() as unknown as SupabaseClient;
  const { data } = await db.from("projects").select("firm_id").eq("id", id).maybeSingle<{ firm_id: string | null }>();
  if (!data?.firm_id) {
    return (
      <div data-system="blueprint" className="mx-auto max-w-[720px]">
        <StateBlock kind="empty" icon="menu_book" title="No firm book on this project" actions={<Button kind="primary" href={`/project/${id}`}>Open the project hub</Button>}>
          Rates come from the firm the project is attached to. Until a firm is attached, every line prices from the market reference.
        </StateBlock>
      </div>
    );
  }
  return <FirmBook firmId={data.firm_id} />;
}
