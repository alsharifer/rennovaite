import { curateBoq, loadWithheldNames } from "@/lib/identity/curation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  ALL_RELEVANT_CATEGORIES,
  categoriesForLine,
} from "@/lib/vendor-options-helpers";

import { Button } from "@/components/blueprint/Button";
import { PageHeader } from "@/components/blueprint/PageHeader";
import { StateBlock } from "@/components/blueprint/StateBlock";
import { loadProjectRail } from "@/components/blueprint/shell/ProjectShell";
import { StepTabs } from "@/components/blueprint/shell/StepTabs";
import { TopBarActions } from "@/components/blueprint/shell/TopBar";
import { revLine } from "@/components/blueprint/shell/rev-line";
import { Suppliers, type SupplierLine, type SupplierOption, type SuppliersBoq } from "@/components/blueprint/tender/Suppliers";
import type { RevisionBoq } from "@/lib/boq/revision-diff";
import { estimateOf } from "@/lib/hub/estimate";
import { journeyFlagsFromEnv, ownerStep } from "@/lib/journey";
import { stepEyebrow } from "@/lib/journey-eyebrow";
import { loadProvenanceContext } from "@/lib/provenance/load";

export const dynamic = "force-dynamic";

/** The major items: the largest share of cost first (spec §6.7). */
const TOP_LANES = 8;

type SkuRow = {
  id: string;
  sku: string | null;
  brand: string | null;
  category: string | null;
  price_aed: number | null;
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
  ohp_pct?: number;
};

function isBoqPayload(v: unknown): v is BoqPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.sections) && typeof o.grand_total_aed === "number";
}

function toOption(sku: SkuRow): SupplierOption {
  return {
    id: sku.id,
    brand: sku.brand,
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

// K8 #8 — 06 Tender · Contractors & suppliers (spec §6.7, Figma 60:913). The
// lines and their catalogue candidates are resolved here exactly as before
// (persisted choice > cited SKU > closest candidate, within ±25% of the BoQ
// rate); the screen is components/blueprint/tender/Suppliers.
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
      .select("id")
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
        "id, sku, brand, category, price_aed, lead_time_days, in_stock",
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
    // Shared boundary: app/project/[id]/not-found.tsx.
    notFound();
  }

  const rail = await loadProjectRail(id);
  const persona = rail?.persona ?? "owner";
  const flags = journeyFlagsFromEnv();
  const latestBoq = boqRes.data?.[0];
  const header = (meta?: string) => (
    <PageHeader
      eyebrow={stepEyebrow(persona, "", "tender", "Tender")}
      title="Contractors & suppliers"
      intro="For each major item we found up to three suppliers in Dubai. Swap, compare and choose — your cost updates as you go. Then send the scope to contractors to bid."
      tabs={<StepTabs step="tender" projectId={id} active="suppliers" persona={persona} meta={{ documents: "drawings · cost · tender pack", suppliers: meta }} />}
    />
  );
  if (!latestBoq || !isBoqPayload(latestBoq.sections)) {
    return (
      <div className="mx-auto max-w-[1344px] px-6 pb-16 pt-8 lg:px-12" data-suppliers>
        {header()}
        <div className="mt-8 max-w-[720px]">
          <StateBlock kind="empty" icon="storefront" title="No bill of quantities yet" actions={<Button kind="primary" href={`/project/${id}/boq`}>Open cost</Button>}>
            Suppliers are matched to the items in your bill of quantities. Generate it first.
          </StateBlock>
        </div>
      </div>
    );
  }

  // I4: curated on its way to the browser — a stored BoQ may predate the source scrub.
  const boqPayload = curateBoq(latestBoq.sections, await loadWithheldNames(sb, id));
  const boqId = latestBoq.id;

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

  // The material-bearing lines with at least one usable catalogue SKU.
  const lineCards: SupplierLine[] = [];

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
        quantity: line.quantity,
        unit: line.unit,
        base_total_aed: line.total_aed,
        current: toOption(currentSku),
        alternatives,
      });
    }
  }

  const topLanes = [...lineCards].sort((a, b) => b.base_total_aed - a.base_total_aed).slice(0, TOP_LANES);

  // The stored headline (≈ … * + weakest mark), the same figure the BoQ pins.
  const e = estimateOf(latestBoq.sections as unknown as RevisionBoq, await loadProvenanceContext(sb, id));
  const boq: SuppliersBoq = {
    boq_id: boqId,
    rev: rail?.project?.rev ?? null,
    contingency_pct: boqPayload.contingency_pct,
    vat_pct: boqPayload.vat_pct,
    ohp_pct: boqPayload.ohp_pct,
    base_subtotal_aed: boqPayload.subtotal_aed,
    stored_grand_aed: e.grand,
    estimate: e.estimate,
    excluded: e.excluded.length,
    tier: e.tier,
  };

  // Send waits for the rail's Tender block, in the button's words.
  const n = e.excluded.length;
  const tender = rail?.statuses.tender;
  const sendBlocked =
    n > 0
      ? `Locked until every item has a price — ${n} item${n === 1 ? "" : "s"} in ${persona === "owner" ? `${ownerStep("cost").number} Cost` : "the BoQ"} ${n === 1 ? "isn’t" : "aren’t"} priced yet.`
      : tender?.state === "blocked"
        ? `Locked until the plan check passes — ${tender.reason ?? "the plan has a problem"}.`
        : null;

  return (
    <div className="mx-auto max-w-[1344px] px-6 pb-16 pt-8 lg:px-12" data-suppliers>
      {rail?.project ? (
        <TopBarActions>
          <span className="t-label-md hidden font-bp-mono text-bp-ink-tertiary lg:inline">{revLine(rail.project)}</span>
        </TopBarActions>
      ) : null}
      {header(topLanes.length ? `${topLanes.length} item${topLanes.length === 1 ? "" : "s"}` : undefined)}
      <div className="mt-8">
        {topLanes.length === 0 ? (
          <div className="max-w-[720px]">
            <StateBlock kind="empty" icon="storefront" title="No supplier options for this BoQ">
              None of its items has a catalogue product within a quarter of its rate yet. The documents still go to contractors as they stand.
            </StateBlock>
          </div>
        ) : (
          <Suppliers projectId={id} boq={boq} lines={topLanes} sendBlocked={sendBlocked} documentsHref={flags.drawingsEnabled ? `/project/${id}/drawings` : null} />
        )}
      </div>
    </div>
  );
}
