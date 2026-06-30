import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only aggregate over feedback_events — accept/reject ratios per KG bundle.
// This is the raw material the KG edge-reweighting job will consume later; for
// now it just proves capture works. Optional ?project_id= filter.
type ActionTally = {
  kg_bundle_id: string;
  accepted: number;
  rejected: number;
  iterated: number;
  swapped: number;
  edited: number;
  total: number;
  accept_ratio: number | null; // accepted / (accepted + rejected)
};

const ACTIONS = [
  "accepted",
  "rejected",
  "iterated",
  "swapped",
  "edited",
] as const;
type Action = (typeof ACTIONS)[number];

export async function GET(request: NextRequest) {
  try {
    const projectId = new URL(request.url).searchParams.get("project_id");

    let query = getSupabaseAdmin()
      .from("feedback_events")
      .select("kg_bundle_id, action");
    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query;

    if (error) {
      const msg = error.message ?? "";
      if (
        msg.includes("feedback_events") &&
        (msg.includes("does not exist") ||
          msg.includes("Could not find the table"))
      ) {
        return NextResponse.json({
          ok: true,
          table_missing: true,
          hint: "Run scripts/migrations/009_feedback_events.sql in the Supabase SQL editor.",
          bundles: [],
        });
      }
      throw new Error(msg);
    }

    const rows = (data ?? []) as { kg_bundle_id: string | null; action: string }[];

    const byBundle = new Map<string, ActionTally>();
    let ungrounded = 0;
    for (const r of rows) {
      if (!r.kg_bundle_id) {
        ungrounded++;
        continue;
      }
      let t = byBundle.get(r.kg_bundle_id);
      if (!t) {
        t = {
          kg_bundle_id: r.kg_bundle_id,
          accepted: 0,
          rejected: 0,
          iterated: 0,
          swapped: 0,
          edited: 0,
          total: 0,
          accept_ratio: null,
        };
        byBundle.set(r.kg_bundle_id, t);
      }
      if ((ACTIONS as readonly string[]).includes(r.action)) {
        t[r.action as Action] += 1;
      }
      t.total += 1;
    }

    const bundles = [...byBundle.values()]
      .map((t) => {
        const denom = t.accepted + t.rejected;
        return {
          ...t,
          accept_ratio: denom > 0 ? Math.round((t.accepted / denom) * 100) / 100 : null,
        };
      })
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      ok: true,
      total_events: rows.length,
      ungrounded_events: ungrounded, // events with no kg_bundle_id (e.g. style picks)
      bundle_count: bundles.length,
      bundles,
    });
  } catch (err) {
    console.error("[api/debug/feedback-summary] error", err);
    const message = err instanceof Error ? err.message : "Summary failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
