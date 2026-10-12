import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { publicUrlForPath } from "@/lib/assets/load";
import { getCaller, unauthenticated } from "@/lib/auth/caller";
import { getBranding, updateBranding, type FirmBranding } from "@/lib/firms/branding";
import { UuidSchema, badRequest, firmDb, storeErrorResponse } from "@/lib/firms/http";
import { uploadErrorResponse } from "@/lib/uploads/http";
import { finishUpload } from "@/lib/uploads/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L4 — what this firm's client sees on a proposal. Members only (401 / 403 / 404).
//
//   GET   /api/firms/:firmId/branding            { display_name, logo_url, terms_text, brand }
//   PATCH /api/firms/:firmId/branding            { display_name?, terms_text? }
//   POST  /api/firms/:firmId/branding            { path } of the uploaded logo (H9; PNG / JPG — lib/uploads/limits.ts)

const PatchSchema = z
  .object({ display_name: z.string().trim().max(120).nullable().optional(), terms_text: z.string().trim().max(8000).nullable().optional() })
  .refine((b) => b.display_name !== undefined || b.terms_text !== undefined, "Body needs display_name or terms_text.");

type Ctx = { params: Promise<{ firmId: string }> };

const view = (b: FirmBranding) => ({ firm_id: b.firm_id, name: b.name, display_name: b.display_name, brand: b.brand, terms_text: b.terms_text, logo_url: b.logo_path ? publicUrlForPath(b.logo_path) : null });

export async function GET(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  try {
    return NextResponse.json({ success: true, branding: view(await getBranding(firmDb(), firmId, caller)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.message);
  try {
    return NextResponse.json({ success: true, branding: view(await updateBranding(firmDb(), firmId, parsed.data, caller)) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const caller = await getCaller(request);
  if (!caller) return unauthenticated("Sign in to work with a firm.");
  const { firmId } = await ctx.params;
  if (!UuidSchema.safeParse(firmId).success) return badRequest("Invalid firm id.");
  // H9: the logo was uploaded straight to Storage (kind "logo", signed for THIS firm).
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  if (!body || typeof body.path !== "string") return badRequest("Upload the logo first, then send its path.");
  if (!body.path.startsWith(`pending/logo/${firmId}/`)) return badRequest("That upload is not for this firm.");
  try {
    return NextResponse.json(await finishUpload(firmDb(), caller, body.path, {}, "logo"), { status: 201 });
  } catch (e) {
    return uploadErrorResponse(e, "api/firms/branding");
  }
}
