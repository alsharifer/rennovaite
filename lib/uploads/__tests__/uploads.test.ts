// =============================================================================
// H9 — direct-to-storage uploads: sign → (browser PUT) → complete, against an
// in-memory Storage. Every file here is synthetic, generated in the test —
// never a client drawing.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/firms/__tests__/fake-db";
import type { Caller } from "@/lib/auth/caller";

vi.mock("@/lib/assets/load", async (orig) => ({
  ...(await orig<typeof import("@/lib/assets/load")>()),
  publicUrlForPath: (p: string) => `https://storage.test/object/public/plan-uploads/${p}`,
}));

import { FILE_TYPES, MiB, checkDeclared, declaredType, sniffType, uploadError } from "../limits";
import { finishUpload } from "../register";
import { UPLOAD_BUCKET, UploadError, completeUpload, parsePendingPath, pendingPath, signUpload } from "../server";
import { attachStorage, syntheticExe, syntheticPdf, syntheticPng, syntheticXlsx, type FakeStorage } from "./fake-storage";

const alice: Caller = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "alice@test.local" };
const bob: Caller = { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "bob@test.local" };
const P1 = "11111111-1111-4111-8111-111111111111";
const F1 = "ffffffff-1111-4111-8111-111111111111";

let db: FakeDb;
let storage: FakeStorage;

beforeEach(() => {
  db = fakeDb({
    projects: [{ id: P1, firm_id: null }],
    project_members: [{ project_id: P1, user_id: alice.id }],
    firms: [{ id: F1, name: "Test firm" }],
    firm_members: [{ firm_id: F1, user_id: alice.id }],
  });
  storage = attachStorage(db.client);
});

/** sign → browser PUT. Returns the pending path. */
async function put(caller: Caller, req: Parameters<typeof signUpload>[2], bytes: Uint8Array) {
  const signed = await signUpload(db.client, caller, req);
  expect(storage.browserPut(signed.signedUrl, bytes)).toBe(200);
  return signed.path;
}

async function refusal(p: Promise<unknown>): Promise<{ status: number; code: string; kind?: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof UploadError) return { status: e.status, ...e.body };
    const s = e as { status?: number; code?: string };
    return { status: s.status ?? 500, code: s.code ?? String(e) };
  }
  throw new Error("expected a refusal");
}

describe("H9 plan uploads (intake)", () => {
  it.each([6, 19])("a %i MB PDF signs, uploads direct, completes and becomes a project", async (mb) => {
    const bytes = syntheticPdf(mb * MiB);
    const path = await put(alice, { kind: "plan", size: bytes.byteLength, type: "application/pdf", filename: "plan.pdf" }, bytes);
    expect(path).toMatch(new RegExp(`^pending/plan/new/${alice.id}/[0-9a-f-]{36}\\.pdf$`));

    const out = (await finishUpload(db.client, alice, path, { filename: "plan.pdf" }, "plan")) as { project_id: string; plan_id: string; pdf_url: string; sha256: string };
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Out of pending/, into the pipeline's bucket at the path parse reads.
    expect(storage.objects(UPLOAD_BUCKET)).toEqual([]);
    const stored = storage.objects("plan-uploads");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(new RegExp(`^${out.project_id}/[0-9a-f-]{36}\\.pdf$`));
    expect(storage.buckets.get("plan-uploads")!.get(stored[0]!)!.bytes.byteLength).toBe(mb * MiB);
    expect(out.pdf_url).toContain(stored[0]);
    // H5: the uploader is the new project's member.
    expect(db.tables.project_members).toContainEqual(expect.objectContaining({ project_id: out.project_id, user_id: alice.id }));
    expect(db.tables.plans).toContainEqual(expect.objectContaining({ id: out.plan_id, project_id: out.project_id }));
  });

  it("a 21 MB PDF is refused AT SIGN — 413, no URL minted, zero bytes stored", async () => {
    const r = await refusal(signUpload(db.client, alice, { kind: "plan", size: 21 * MiB, type: "application/pdf", filename: "big.pdf" }));
    expect(r).toMatchObject({ status: 413, code: "payload_too_large", kind: "plan" });
    expect(storage.signed.size).toBe(0);
    expect([...storage.buckets.values()].every((b) => b.size === 0)).toBe(true);
  });

  it("an .exe renamed .pdf: the declared type passes sign, complete sniffs it, deletes it, 415", async () => {
    const bytes = syntheticExe(2 * MiB);
    const path = await put(alice, { kind: "plan", size: bytes.byteLength, type: "application/pdf", filename: "plan.pdf" }, bytes);
    const r = await refusal(finishUpload(db.client, alice, path, {}, "plan"));
    expect(r).toMatchObject({ status: 415, code: "unsupported_type", kind: "plan" });
    expect(storage.objects(UPLOAD_BUCKET)).toEqual([]);
    expect(db.tables.projects).toHaveLength(1); // no project was created
  });

  it("a declared non-allowed type is refused at sign with 415", async () => {
    const r = await refusal(signUpload(db.client, alice, { kind: "plan", size: MiB, type: "application/x-msdownload", filename: "setup.exe" }));
    expect(r).toMatchObject({ status: 415, code: "unsupported_type", kind: "plan" });
    expect(storage.signed.size).toBe(0);
  });
});

describe("H9 real size is checked at complete", () => {
  it("a quote declared 1 MB that is really 6 MB: complete deletes it and answers 413", async () => {
    const bytes = syntheticXlsx(6 * MiB);
    const path = await put(alice, { kind: "quote", scopeId: F1, size: 1 * MiB, type: FILE_TYPES.xlsx.mime, filename: "q.xlsx" }, bytes);
    expect(storage.objects(UPLOAD_BUCKET)).toHaveLength(1);
    const r = await refusal(finishUpload(db.client, alice, path, { supplier_label: "S" }, "quote"));
    expect(r).toMatchObject({ status: 413, code: "payload_too_large", kind: "quote" });
    expect(storage.objects(UPLOAD_BUCKET)).toEqual([]);
  });

  it("a project photo of 15 MB completes into the asset library", async () => {
    const bytes = syntheticPng(15 * MiB);
    const path = await put(alice, { kind: "project_asset", scopeId: P1, size: bytes.byteLength, type: "image/png", filename: "site.png", assetKind: "photo" }, bytes);
    const out = (await finishUpload(db.client, alice, path, { asset_kind: "photo", source: "intake" }, "project_asset")) as { asset_id: string };
    expect(db.tables.project_assets).toContainEqual(expect.objectContaining({ id: out.asset_id, project_id: P1, kind: "photo", bytes: 15 * MiB }));
    expect(storage.objects(UPLOAD_BUCKET)).toEqual([]);
    expect(storage.objects("plan-uploads")[0]).toMatch(new RegExp(`^${P1}/assets/`));
  });

  it("a PDF filed as a photo asset is refused (asset kinds narrow the types)", async () => {
    const r = await refusal(signUpload(db.client, alice, { kind: "project_asset", scopeId: P1, size: MiB, type: "application/pdf", filename: "x.pdf", assetKind: "photo" }));
    expect(r).toMatchObject({ status: 415, code: "unsupported_type" });
  });
});

describe("H9 authority", () => {
  it("a second account cannot sign for the first account's project (403)", async () => {
    const r = await refusal(signUpload(db.client, bob, { kind: "project_asset", scopeId: P1, size: MiB, type: "image/png", filename: "x.png", assetKind: "photo" }));
    expect(r).toMatchObject({ status: 403, code: "not_a_project_member" });
    expect(storage.signed.size).toBe(0);
  });

  it("a second account cannot sign for the first account's firm (403)", async () => {
    const r = await refusal(signUpload(db.client, bob, { kind: "logo", scopeId: F1, size: 100_000, type: "image/png", filename: "l.png" }));
    expect(r).toMatchObject({ status: 403, code: "not_a_member" });
  });

  it("no session, no signature (401)", async () => {
    expect(await refusal(signUpload(db.client, null, { kind: "plan", size: MiB, type: "application/pdf" }))).toMatchObject({ status: 401 });
  });

  it("a path signed by someone else cannot be completed by the caller (403), and is left alone", async () => {
    const bytes = syntheticPdf(MiB);
    const path = await put(alice, { kind: "plan", size: bytes.byteLength, type: "application/pdf" }, bytes);
    const r = await refusal(finishUpload(db.client, bob, path, {}, "plan"));
    expect(r).toMatchObject({ status: 403, code: "upload_not_yours" });
    expect(storage.objects(UPLOAD_BUCKET)).toEqual([path]);
  });

  it("a path we never signed is 403 — outside pending/, a forged signer, another bucket's layout", async () => {
    for (const path of [`${P1}/assets/x.pdf`, pendingPath("plan", "new", bob.id, "pdf"), "pending/plan/new/../../etc/passwd", 42]) {
      expect(await refusal(completeUpload(db.client, alice, path))).toMatchObject({ status: 403, code: "upload_not_yours" });
    }
  });

  it("a signer who has since lost membership cannot complete into the project", async () => {
    const bytes = syntheticPng(MiB);
    const path = await put(alice, { kind: "project_asset", scopeId: P1, size: bytes.byteLength, type: "image/png", assetKind: "photo" }, bytes);
    db.tables.project_members = [];
    expect(await refusal(finishUpload(db.client, alice, path, { asset_kind: "photo" }))).toMatchObject({ status: 403 });
  });

  it("a completion that never uploaded is upload_failed, not a crash", async () => {
    const signed = await signUpload(db.client, alice, { kind: "plan", size: MiB, type: "application/pdf" });
    expect(await refusal(finishUpload(db.client, alice, signed.path, {}, "plan"))).toMatchObject({ status: 400, code: "upload_failed", kind: "plan" });
  });

  it("a kind-specific route refuses another kind's path", async () => {
    const bytes = syntheticPdf(MiB);
    const path = await put(alice, { kind: "plan", size: bytes.byteLength, type: "application/pdf" }, bytes);
    expect(await refusal(finishUpload(db.client, alice, path, {}, "room_photo"))).toMatchObject({ status: 400, code: "wrong_upload_kind" });
  });
});

describe("H9 limits table + pure helpers", () => {
  it("magic bytes decide the type, not the name", () => {
    expect(sniffType(syntheticPdf(2048))).toBe("pdf");
    expect(sniffType(syntheticPng(64))).toBe("png");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffType(syntheticXlsx(64))).toBe("xlsx");
    expect(sniffType(new TextEncoder().encode("AC1032\0\0"))).toBe("dwg");
    expect(sniffType(new TextEncoder().encode("  0\r\nSECTION\r\n  2\r\nHEADER"))).toBe("dxf");
    expect(sniffType(syntheticExe(512))).toBeNull();
    expect(declaredType("", "plan.PDF")).toBe("pdf");
    expect(declaredType("image/jpeg", null)).toBe("jpg");
  });

  it("checkDeclared is the one rule both sides apply", () => {
    expect(checkDeclared("plan", 20 * MiB, "pdf")).toBeNull();
    expect(checkDeclared("plan", 20 * MiB + 1, "pdf")).toBe("payload_too_large");
    expect(checkDeclared("logo", 1000, "pdf")).toBe("unsupported_type");
    expect(checkDeclared("plan", 0, "pdf")).toBe("upload_failed");
  });

  it("one error shape, and its sentence names no number (K6 copy rule)", () => {
    for (const code of ["payload_too_large", "unsupported_type", "upload_failed"] as const) {
      const body = uploadError(code, "plan");
      expect(Object.keys(body).sort()).toEqual(["code", "error", "kind"]);
      expect(body.error).not.toMatch(/\d/);
    }
  });

  it("pending paths round-trip and only well-formed ones parse", () => {
    const p = pendingPath("quote", F1, alice.id, "xlsx");
    expect(parsePendingPath(p)).toMatchObject({ kind: "quote", scopeId: F1, callerId: alice.id, ext: "xlsx" });
    expect(parsePendingPath(pendingPath("plan", F1, alice.id, "pdf"))).toBeNull(); // a plan's scope is "new"
    expect(parsePendingPath(pendingPath("quote", "new", alice.id, "xlsx"))).toBeNull();
    expect(parsePendingPath("pending/virus/new/x/y.pdf")).toBeNull();
  });
});
