import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  ALL_RELEVANT_CATEGORIES,
  categoriesForLine,
} from "@/lib/vendor-options-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BodySchema = z.object({
  boq_id: z.string().uuid(),
});

// Lines are not persisted with their own id today — they're array entries
// inside boqs.sections. We synthesize a stable key per (section, idx) so
// the frontend can iterate the same way and look up options.
const BoqLineSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  rate_aed: z.number(),
  total_aed: z.number(),
  vendor_or_source: z.string(),
  notes: z.string().nullable(),
});
const BoqSectionSchema = z.object({
  work_section: z.string(),
  lines: z.array(BoqLineSchema),
  section_total_aed: z.number(),
});
const BoqPayloadSchema = z.object({
  sections: z.array(BoqSectionSchema),
});

type PricingSku = {
  id: string;
  sku: string | null;
  brand: string | null;
  category: string | null;
  description_en: string | null;
  price_aed: number | null;
  photo_url: string | null;
  lead_time_days: number | null;
  in_stock: boolean | null;
  vendor: string | null;
};

type VendorOption = {
  id: string;
  sku: string | null;
  brand: string | null;
  description: string | null;
  photo_url: string | null;
  price_aed: number;
  lead_time_days: number | null;
  in_stock: boolean | null;
};

function toOption(sku: PricingSku): VendorOption {
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    const parsedBody = BodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "boq_id (uuid) is required." },
        { status: 400 },
      );
    }
    const { boq_id } = parsedBody.data;

    const supabase = getSupabaseAdmin();
    const supabaseUntyped = supabase as unknown as SupabaseClient;

    // 1. Load the BoQ.
    const { data: boq, error: boqErr } = await supabase
      .from("boqs")
      .select("id, sections")
      .eq("id", boq_id)
      .single();
    if (boqErr || !boq) {
      return NextResponse.json(
        { success: false, error: "BoQ not found." },
        { status: 404 },
      );
    }

    const payloadCheck = BoqPayloadSchema.safeParse(boq.sections);
    if (!payloadCheck.success) {
      return NextResponse.json(
        { success: false, error: "BoQ sections payload is malformed." },
        { status: 500 },
      );
    }
    const { sections } = payloadCheck.data;

    // 2. Pre-load every SKU we might match against, in one query.
    const { data: skus, error: skuErr } = await supabaseUntyped
      .from("pricing_skus")
      .select(
        "id, sku, brand, category, description_en, price_aed, photo_url, lead_time_days, in_stock, vendor",
      )
      .in("category", ALL_RELEVANT_CATEGORIES)
      .not("price_aed", "is", null)
      .returns<PricingSku[]>();

    if (skuErr) {
      throw new Error(`pricing_skus query failed: ${skuErr.message}`);
    }
    const allSkus = skus ?? [];

    // 3. Per line: filter by category + ±25% price band, sort by absolute
    //    price delta, take the top 3.
    const line_options: Record<string, VendorOption[]> = {};

    for (const section of sections) {
      for (let idx = 0; idx < section.lines.length; idx++) {
        const line = section.lines[idx]!;
        const key = `${section.work_section}-${idx}`;
        const cats = categoriesForLine(section.work_section, line.description);

        if (cats.length === 0 || line.rate_aed <= 0) {
          line_options[key] = [];
          continue;
        }

        const min = line.rate_aed * 0.75;
        const max = line.rate_aed * 1.25;

        line_options[key] = allSkus
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

    return NextResponse.json({ success: true, line_options });
  } catch (err) {
    console.error("[api/vendor-options] error", err);
    const message =
      err instanceof Error ? err.message : "Vendor options lookup failed.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
