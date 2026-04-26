import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "plan-uploads";
const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  return "bin";
}

export async function POST(request: NextRequest) {
  let createdProjectId: string | null = null;

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided." },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF, PNG, or JPG." },
        { status: 400 },
      );
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File is larger than 20 MB." },
        { status: 400 },
      );
    }

    const { data: project, error: projectErr } = await supabaseAdmin
      .from("projects")
      .insert({ city: "Dubai", name: "Untitled" })
      .select("id")
      .single();

    if (projectErr || !project) {
      throw projectErr ?? new Error("Failed to create project row.");
    }
    createdProjectId = project.id;

    const path = `${project.id}/${crypto.randomUUID()}.${extensionFor(file)}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      throw uploadErr;
    }

    const {
      data: { publicUrl: pdf_url },
    } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

    const { data: plan, error: planErr } = await supabaseAdmin
      .from("plans")
      .insert({ project_id: project.id, pdf_url })
      .select("id")
      .single();

    if (planErr || !plan) {
      throw planErr ?? new Error("Failed to create plan row.");
    }

    return NextResponse.json({
      project_id: project.id,
      plan_id: plan.id,
      pdf_url,
    });
  } catch (err) {
    console.error("[api/upload] error", err);
    if (createdProjectId) {
      await supabaseAdmin
        .from("projects")
        .delete()
        .eq("id", createdProjectId);
    }
    // Supabase throws plain objects with `.message`, not Error instances —
    // `err instanceof Error` would miss those and fall back to the generic
    // string. Pull `.message` off any object that has one.
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Upload failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
