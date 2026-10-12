"use client";

import { useEffect, useRef, useState } from "react";
import { UploadFailed, uploadDirect } from "@/lib/uploads/client";

// L4 — what this firm's client sees on a proposal: the display name (defaults
// to the registered name), a logo, and a free-text terms block. Every request
// goes to THIS firm's branding route only.

interface Branding {
  firm_id: string;
  name: string;
  display_name: string | null;
  brand: string;
  terms_text: string | null;
  logo_url: string | null;
}
type ApiError = { error?: string; code?: string };

export function BrandingPanel({ firmId }: { firmId: string }) {
  const [b, setB] = useState<Branding | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/firms/${firmId}/branding`)
      .then((r) => r.json() as Promise<{ branding?: Branding } & ApiError>)
      .then((body) => {
        if (cancelled || !body.branding) return;
        setB(body.branding);
        setDisplayName(body.branding.display_name ?? "");
        setTerms(body.branding.terms_text ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  async function save() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/firms/${firmId}/branding`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: displayName.trim() || null, terms_text: terms.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { branding?: Branding } & ApiError;
      if (!res.ok || !body.branding) {
        setError(body.error ?? `The request failed (${res.status}).`);
        return;
      }
      setB(body.branding);
      setMsg(`Saved. Proposals print "${body.branding.brand}".`);
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    const f = file.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      // H9: the logo goes straight to Storage on a URL signed for THIS firm.
      let path: string;
      try {
        path = (await uploadDirect(f, { kind: "logo", firmId })).path;
      } catch (err) {
        setError(err instanceof UploadFailed ? err.message : "The upload didn't complete. Please try again.");
        return;
      }
      const res = await fetch(`/api/firms/${firmId}/branding`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
      const body = (await res.json().catch(() => ({}))) as { branding?: Branding } & ApiError;
      if (!res.ok || !body.branding) {
        setError(body.error ?? `The upload failed (${res.status}).`);
        return;
      }
      setB(body.branding);
      setMsg("Logo saved.");
      if (file.current) file.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-bp-line-hairline pt-4" aria-label="Proposal branding" data-testid="branding-panel">
      <p className="t-label-caps text-bp-ink-tertiary">Proposal branding — what your client sees</p>
      <p className="mt-1 max-w-[672px] t-body-sm text-bp-ink-secondary">
        A client proposal is your document: it carries this name and logo on the cover and your terms at the end. RenovAIte appears only
        as a small &ldquo;prepared with&rdquo; mark. Contractor and reference identities never appear on it.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <span className="t-label-caps text-bp-ink-tertiary">Display name on proposals</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={b?.name ?? "Registered name"}
            aria-label="Display name"
            className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary"
          />
          <span className="mt-1 block t-label-md text-bp-ink-tertiary">Empty = the registered name{b ? ` (${b.name})` : ""}.</span>
        </label>
        <div>
          <span className="t-label-caps text-bp-ink-tertiary">Logo (PNG or JPG, under 1 MB)</span>
          <div className="mt-1 flex items-center gap-3">
            {b?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo_url} alt="Firm logo" className="h-12 w-auto border border-bp-line-hairline" data-testid="branding-logo" />
            ) : (
              <span className="t-label-md text-bp-ink-tertiary">No logo yet.</span>
            )}
            <input ref={file} type="file" accept="image/png,image/jpeg" aria-label="Logo file" className="t-body-sm" />
            <button type="button" onClick={upload} disabled={busy} className="inline-flex h-9 items-center gap-2 border border-bp-line-control px-4 t-nav-item-active text-bp-ink-primary hover:bg-bp-surface-sunken disabled:opacity-50">
              Upload
            </button>
          </div>
        </div>
        <label className="block md:col-span-2">
          <span className="t-label-caps text-bp-ink-tertiary">Terms (printed as written)</span>
          <textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={5}
            aria-label="Terms text"
            className="t-body-sm mt-1 h-10 w-full rounded-none border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary h-auto py-2"
            placeholder="Validity, payment schedule, exclusions, variations…"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" onClick={save} disabled={busy || !b} className="inline-flex h-9 items-center bg-bp-ink-primary px-4 t-nav-item-active text-bp-ink-on-inverse hover:bg-bp-ink-secondary aria-disabled:opacity-50 disabled:opacity-50" data-testid="branding-save">
          Save branding
        </button>
        {msg && <span className="t-body-sm text-bp-ink-secondary">{msg}</span>}
        {error && (
          <span role="alert" className="t-body-sm text-bp-ink-primary">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
