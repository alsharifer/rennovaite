"use client";

import { useEffect, useRef, useState } from "react";

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
      const fd = new FormData();
      fd.append("logo", f);
      const res = await fetch(`/api/firms/${firmId}/branding`, { method: "POST", body: fd });
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
    <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Proposal branding" data-testid="branding-panel">
      <p className="label-caps text-ink-500">Proposal branding — what your client sees</p>
      <p className="mt-xs max-w-[672px] text-body-sm text-ink-700">
        A client proposal is your document: it carries this name and logo on the cover and your terms at the end. RennovAIte appears only
        as a small &ldquo;prepared with&rdquo; mark. Contractor and reference identities never appear on it.
      </p>
      <div className="mt-md grid grid-cols-1 gap-md md:grid-cols-2">
        <label className="block">
          <span className="label-caps text-ink-500">Display name on proposals</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={b?.name ?? "Registered name"}
            aria-label="Display name"
            className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900"
          />
          <span className="mt-xs block text-[12px] text-ink-500">Empty = the registered name{b ? ` (${b.name})` : ""}.</span>
        </label>
        <div>
          <span className="label-caps text-ink-500">Logo (PNG or JPG, under 1 MB)</span>
          <div className="mt-xs flex items-center gap-sm">
            {b?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo_url} alt="Firm logo" className="matte-image h-12 w-auto" data-testid="branding-logo" />
            ) : (
              <span className="text-[12px] text-ink-500">No logo yet.</span>
            )}
            <input ref={file} type="file" accept="image/png,image/jpeg" aria-label="Logo file" className="text-body-sm" />
            <button type="button" onClick={upload} disabled={busy} className="focus-ring rounded-lg border border-ink-100 px-sm py-[3px] text-[12px] text-ink-700 disabled:opacity-50">
              Upload
            </button>
          </div>
        </div>
        <label className="block md:col-span-2">
          <span className="label-caps text-ink-500">Terms (printed as written)</span>
          <textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={5}
            aria-label="Terms text"
            className="focus-ring mt-xs w-full rounded border border-ink-100 bg-paper px-sm py-xs font-body text-body-sm text-ink-900"
            placeholder="Validity, payment schedule, exclusions, variations…"
          />
        </label>
      </div>
      <div className="mt-md flex flex-wrap items-center gap-md">
        <button type="button" onClick={save} disabled={busy || !b} className="focus-ring rounded-lg bg-brass-600 px-md py-xs text-body-sm font-semibold text-white disabled:opacity-50" data-testid="branding-save">
          Save branding
        </button>
        {msg && <span className="text-body-sm text-ink-700">{msg}</span>}
        {error && (
          <span role="alert" className="text-body-sm text-error">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
