import type { SupabaseClient } from "@supabase/supabase-js";

import { AppShell } from "@/components/app/AppShell";
import { JourneyProgress } from "@/components/app/JourneyChrome";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  ALL_RELEVANT_CATEGORIES,
  categoriesForLine,
} from "@/lib/vendor-options-helpers";

import {
  VendorPicker,
  type LineCard,
  type VendorOption,
  type BoqMeta,
} from "./_components/vendor-picker";

export const dynamic = "force-dynamic";

const PAGE_NAME = "Vendors";
const FALLBACK_BUDGET_AED = 850000;
const TOP_LANES = 8;

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

type BoqLine = {
  description: string;
  quantity: number;
  unit: string;
  rate_aed: number;
  total_aed: number;
  vendor_or_source: string;
  notes: string | null;
};

type BoqSection = {
  work_section: string;
  lines: BoqLine[];
  section_total_aed: number;
};

type BoqPayload = {
  sections: BoqSection[];
  subtotal_aed: number;
  contingency_pct: number;
  contingency_aed: number;
  vat_pct: number;
  vat_aed: number;
  grand_total_aed: number;
};

function isBoqPayload(v: unknown): v is BoqPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.sections) && typeof o.grand_total_aed === "number";
}

function toOption(sku: SkuRow): VendorOption {
  return {
    id: sku.id,
    sku: sku.sku,
    brand: sku.brand,
    description: sku.description_en,
    photo_url: sku.photo_url,
    price_aed: sku.price_aed ?? 0,
    lead_time_days: sku.lead_time_days,
    in_stock: sku.in_stock,
  };
}

// Pulls a SKU code out of a free-form "vendor_or_source" string. The BoQ
// generator typically cites SKUs like "RAK Ceramics — RAK-MRB-VERSILIA-60X60";
// we grab the rightmost dashed all-caps token that matches a real SKU code.
function extractSkuCode(
  vendorOrSource: string,
  skuCodes: Set<string>,
): string | null {
  const candidates = vendorOrSource.match(/[A-Z][A-Z0-9-]{4,}/g) ?? [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (skuCodes.has(candidates[i]!)) return candidates[i]!;
  }
  return null;
}

export default async function VendorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  const [projectRes, boqRes, skuRes, selectionRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, city, budget_aed")
      .eq("id", id)
      .single(),
    supabase
      .from("boqs")
      .select("id, total_aed, sections, created_at")
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
    sb
      .from("vendor_selections")
      .select("boq_id, boq_line_id, sku_id")
      .eq("project_id", id)
      .returns<{ boq_id: string; boq_line_id: string; sku_id: string }[]>(),
  ]);

  if (projectRes.error || !projectRes.data) {
    return (
      <AppShell pageName={PAGE_NAME}>
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-status-error">Project not found.</p>
        </main>
      </AppShell>
    );
  }

  const latestBoq = boqRes.data?.[0];
  if (!latestBoq || !isBoqPayload(latestBoq.sections)) {
    return (
      <AppShell pageName={PAGE_NAME}>
        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
          <p className="text-on-surface-variant">
            No BoQ yet. Generate the bill of quantities first.
          </p>
        </main>
      </AppShell>
    );
  }

  const project = projectRes.data;
  const boqPayload = latestBoq.sections;
  const boqId = latestBoq.id;
  const budgetAed = project.budget_aed ?? FALLBACK_BUDGET_AED;

  const allSkus: SkuRow[] = skuRes.data ?? [];
  const skuById = new Map(allSkus.map((s) => [s.id, s]));
  const skuCodes = new Set(
    allSkus.filter((s) => s.sku != null).map((s) => s.sku as string),
  );
  const skuByCode = new Map(
    allSkus.filter((s) => s.sku != null).map((s) => [s.sku as string, s]),
  );

  // Existing user selections take precedence.
  const selectionByLine = new Map<string, string>();
  for (const sel of selectionRes.data ?? []) {
    if (sel.boq_id === boqId) {
      selectionByLine.set(sel.boq_line_id, sel.sku_id);
    }
  }

  // Build line cards: material-bearing lines with at least one usable SKU.
  const lineCards: LineCard[] = [];

  for (const section of boqPayload.sections) {
    for (let idx = 0; idx < section.lines.length; idx++) {
      const line = section.lines[idx]!;
      const lineKey = `${section.work_section}-${idx}`;
      const cats = categoriesForLine(section.work_section, line.description);
      if (cats.length === 0 || line.rate_aed <= 0) continue;

      const min = line.rate_aed * 0.75;
      const max = line.rate_aed * 1.25;

      const candidates = allSkus
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
        );

      // Resolve "current": persisted selection > cited SKU > closest candidate.
      let currentSku: SkuRow | null = null;
      const selectedId = selectionByLine.get(lineKey);
      if (selectedId && skuById.has(selectedId)) {
        currentSku = skuById.get(selectedId) ?? null;
      }
      if (!currentSku) {
        const code = extractSkuCode(line.vendor_or_source, skuCodes);
        if (code) currentSku = skuByCode.get(code) ?? null;
      }
      if (!currentSku && candidates.length > 0) {
        currentSku = candidates[0]!;
      }
      if (!currentSku) continue;

      const alternatives = candidates
        .filter((s) => s.id !== currentSku!.id)
        .slice(0, 3)
        .map(toOption);

      lineCards.push({
        line_key: lineKey,
        work_section: section.work_section,
        description: line.description,
        notes: line.notes,
        quantity: line.quantity,
        unit: line.unit,
        base_rate_aed: line.rate_aed,
        base_total_aed: line.total_aed,
        current: toOption(currentSku),
        alternatives,
      });
    }
  }

  const boqMeta: BoqMeta = {
    boq_id: boqId,
    contingency_pct: boqPayload.contingency_pct,
    vat_pct: boqPayload.vat_pct,
    base_subtotal_aed: boqPayload.subtotal_aed,
    base_grand_total_aed: boqPayload.grand_total_aed,
    budget_aed: budgetAed,
  };

  // Top N lines by base_total_aed — the spec is "top 8 BoQ line items".
  const topLanes = [...lineCards]
    .sort((a, b) => b.base_total_aed - a.base_total_aed)
    .slice(0, TOP_LANES);

  return (
    <AppShell pageName={PAGE_NAME}>
      <div className="mx-auto max-w-[1440px] pb-2xl">
        {/* Header */}
        <header className="mb-xl">
          <JourneyProgress stepKey="marketplace" projectId={id} />
          <h1 className="mb-md font-display text-headline-lg text-ink-900">
            Pick your vendors.
          </h1>
          <p className="max-w-[800px] font-body text-body-lg text-on-surface-variant">
            For each major line item we sourced three options across Dubai.
            Swap, compare, and lock — your BoQ updates as you go.
          </p>
        </header>

        {topLanes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-100 bg-paper px-margin py-3xl text-center">
            <p className="text-on-surface-variant">
              No material-bearing lines with alternatives were found for this
              BoQ.
            </p>
          </div>
        ) : (
          <VendorPicker
            projectId={id}
            boqMeta={boqMeta}
            lines={topLanes}
          />
        )}
      </div>
    </AppShell>
  );
}
