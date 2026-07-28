import type { SupabaseClient } from "@supabase/supabase-js";

import { AppShell } from "@/components/app/AppShell";
import { roomRollup } from "@/lib/boq/elements";
import type { TakeoffItem, WorkItemKey } from "@/lib/boq/quantify";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  ALL_RELEVANT_CATEGORIES,
  categoriesForLine,
} from "@/lib/vendor-options-helpers";

import {
  BoqView,
  type BoqPayload,
  type RoomRollupView,
  type VendorOption,
} from "./_components/boq-view";
import { GenerateBoqButton } from "./_components/generate-boq-button";

export const dynamic = "force-dynamic";

const PAGE_NAME = "Bill of Quantities";
const FALLBACK_BUDGET_AED = 850000;
const SEGMENTS = 5;

type SkuRow = {
  id: string;
  sku: string | null;
  brand: string | null;
  category: string | null;
  description_en: string | null;
  price_aed: number | null;
  photo_url: string | null;
  lead_time_days: number | null;
  in_stock: boolean | null;
};

function isBoqPayload(value: unknown): value is BoqPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.sections) &&
    typeof v.subtotal_aed === "number" &&
    typeof v.grand_total_aed === "number"
  );
}

function toOption(s: SkuRow): VendorOption {
  return {
    id: s.id,
    sku: s.sku,
    brand: s.brand,
    description: s.description_en,
    photo_url: s.photo_url,
    price_aed: s.price_aed ?? 0,
    lead_time_days: s.lead_time_days,
    in_stock: s.in_stock,
  };
}

/**
 * Pre-compute up to 3 vendor alternatives per BoQ line, same logic as
 * /api/vendor-options but inline so each row's expansion has data ready
 * without a per-row fetch on click. Same ±25% band + category filter.
 */
function buildLineOptions(
  boq: BoqPayload,
  skus: SkuRow[],
): Record<string, VendorOption[]> {
  const out: Record<string, VendorOption[]> = {};
  for (const section of boq.sections) {
    for (let idx = 0; idx < section.lines.length; idx++) {
      const line = section.lines[idx]!;
      const key = `${section.work_section}-${idx}`;
      const cats = categoriesForLine(section.work_section, line.description);
      if (cats.length === 0 || line.rate_aed <= 0) {
        out[key] = [];
        continue;
      }
      const min = line.rate_aed * 0.75;
      const max = line.rate_aed * 1.25;
      out[key] = skus
        .filter(
          (s) =>
            s.category != null &&
            cats.includes(s.category) &&
            s.price_aed != null &&
            s.price_aed >= min &&
            s.price_aed <= max,
        )
        .sort(
          (a, b) =>
            Math.abs((a.price_aed ?? 0) - line.rate_aed) -
            Math.abs((b.price_aed ?? 0) - line.rate_aed),
        )
        .slice(0, 3)
        .map(toOption);
    }
  }
  return out;
}

export default async function BoqPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ highlight?: string; view?: string; room?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  const [projectRes, boqRes, skuRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, city, budget_aed")
      .eq("id", id)
      .single(),
    supabase
      .from("boqs")
      .select("id, total_aed, sections, locked_at, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    sb
      .from("pricing_skus")
      .select(
        "id, sku, brand, category, description_en, price_aed, photo_url, lead_time_days, in_stock",
      )
      .in("category", ALL_RELEVANT_CATEGORIES)
      .not("price_aed", "is", null)
      .returns<SkuRow[]>(),
  ]);

  if (projectRes.error || !projectRes.data) {
    return (
      <AppShell pageName={PAGE_NAME}>
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-error">Project not found.</p>
        </main>
      </AppShell>
    );
  }

  const project = projectRes.data;
  const budgetAed = project.budget_aed ?? FALLBACK_BUDGET_AED;
  const latestBoq = boqRes.data?.[0];
  const boqPayload =
    latestBoq && isBoqPayload(latestBoq.sections) ? latestBoq.sections : null;
  const skus = skuRes.data ?? [];
  const lineOptions = boqPayload ? buildLineOptions(boqPayload, skus) : {};

  const lineCount =
    boqPayload?.sections.reduce((n, s) => n + s.lines.length, 0) ?? 0;
  const sectionCount = boqPayload?.sections.length ?? 0;

  // P4: per-room rollup from takeoff_items (best-effort; empty if not seeded).
  let byRoom: RoomRollupView[] = [];
  try {
    const { data: tRows } = await sb
      .from("takeoff_items")
      .select("work_item_key, room_id, element_id, qty, unit, wet_area")
      .eq("project_id", id)
      .returns<
        {
          work_item_key: string;
          room_id: string | null;
          element_id: string | null;
          qty: number;
          unit: string;
          wet_area: boolean;
        }[]
      >();
    const items: TakeoffItem[] = (tRows ?? []).map((r) => ({
      work_item_key: r.work_item_key as WorkItemKey,
      room_id: r.room_id,
      element_id: r.element_id ?? "",
      qty: Number(r.qty),
      unit: r.unit,
      wet_area: !!r.wet_area,
    }));
    if (items.length > 0) {
      const rollups = roomRollup(items);
      const { data: roomRows } = await supabase
        .from("rooms")
        .select("id, name_en")
        .in("id", rollups.map((r) => r.room_id));
      const nameById = new Map((roomRows ?? []).map((r) => [r.id, r.name_en]));
      byRoom = rollups.map((r) => ({
        roomId: r.room_id,
        roomName: nameById.get(r.room_id) ?? "Room",
        total_aed: r.total_aed,
        items: r.items.map((w) => ({
          description: w.description,
          qty: w.qty,
          unit: w.unit,
          total_aed: w.total_aed,
        })),
      }));
    }
  } catch {
    /* takeoff_items table absent → no By-room view */
  }

  return (
    <AppShell pageName={PAGE_NAME}>
      <div className="mx-auto max-w-[1440px]">
        {/* Header */}
        <header className="mb-xl">
          <p className="label-caps mb-md text-brass-600">Step 04 of 05</p>
          <div className="mb-xl flex gap-sm" aria-hidden="true">
            {Array.from({ length: SEGMENTS }).map((_, i) => (
              <span
                key={i}
                className={
                  "h-1 flex-1 rounded-full " +
                  (i < 4 ? "bg-brass-600" : "bg-bone")
                }
              />
            ))}
          </div>
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            Your bill of quantities.
          </h1>
          {boqPayload ? (
            <p className="max-w-[800px] font-body text-body-lg text-on-surface-variant">
              {lineCount} line items across {sectionCount} work sections,
              priced against today&apos;s Dubai catalogues. Tap any line for
              sources and sensitivity.
            </p>
          ) : (
            <p className="max-w-[800px] font-body text-body-lg text-on-surface-variant">
              POMI-formatted, sourced from QS-vetted labour rates and Dubai
              supplier SKUs.
            </p>
          )}
        </header>

        {boqPayload ? (
          <BoqView
            projectId={id}
            budgetAed={budgetAed}
            boq={boqPayload}
            lineOptions={lineOptions}
            byRoom={byRoom}
            initialView={sp.view === "byroom" ? "byroom" : "sections"}
            highlightRef={sp.highlight ?? null}
            highlightRoom={sp.room ?? null}
          />
        ) : (
          <EmptyState projectId={id} />
        )}
      </div>
    </AppShell>
  );
}

function EmptyState({ projectId }: { projectId: string }) {
  return (
    <div className="mt-xl flex flex-col items-center gap-lg rounded-2xl border border-dashed border-ink-100 bg-paper px-margin py-3xl text-center">
      <span
        className="material-symbols-outlined text-5xl text-on-surface-variant"
        aria-hidden="true"
      >
        request_quote
      </span>
      <div className="flex flex-col gap-sm">
        <h2 className="font-display text-headline-md text-ink-900">
          No BoQ yet
        </h2>
        <p className="max-w-[520px] font-body text-body-md text-on-surface-variant">
          Generate a priced bill of quantities from the plan, your chosen
          style, and the approved designs. This takes about a minute.
        </p>
      </div>
      <GenerateBoqButton projectId={projectId} />
    </div>
  );
}
