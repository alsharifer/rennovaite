"use client";

import Link from "next/link";
import { useState } from "react";

// U2 — the caller's firms and a create form. Every request is to /api/firms,
// which answers with the caller's firms only; nothing here can name another
// firm's id.

interface Firm {
  id: string;
  name: string;
  private: boolean;
  created_at: string;
}

export function FirmList({ initialFirms, callerEmail }: { initialFirms: Firm[]; callerEmail: string | null }) {
  const [firms, setFirms] = useState<Firm[]>(initialFirms);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the firm a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/firms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; firm?: Firm; error?: string; code?: string };
      if (!res.ok || !body.firm) {
        setError(body.code === "conflict" ? `A firm named “${trimmed}” already exists.` : (body.error ?? `Could not create the firm (${res.status}).`));
        return;
      }
      setFirms((f) => [...f, body.firm!].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-lg">
      <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Your firms">
        <div className="flex items-baseline justify-between">
          <p className="label-caps text-ink-500">Your firms</p>
          {callerEmail && <span className="font-mono text-[12px] text-ink-500">{callerEmail}</span>}
        </div>
        {firms.length === 0 ? (
          <p className="mt-sm text-body-md text-ink-700">You are not a member of any firm yet. Create one below — you become its first member.</p>
        ) : (
          <ul className="mt-sm divide-y divide-ink-100" data-testid="firm-list">
            {firms.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-sm">
                <div>
                  <Link href={`/firms/${f.id}`} className="focus-ring font-display text-headline-md text-ink-900 hover:text-brass-600">
                    {f.name}
                  </Link>
                  <p className="font-mono text-[12px] text-ink-500">{f.private ? "private book" : "shared book"}</p>
                </div>
                <Link href={`/firms/${f.id}`} className="focus-ring inline-flex items-center gap-xs rounded-lg border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-700 hover:border-brass-600">
                  Open rate book
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                    arrow_forward
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-ink-100 bg-paper p-md" aria-label="Create a firm">
        <p className="label-caps text-ink-500">Create a firm</p>
        <div className="mt-sm flex flex-wrap items-start gap-sm">
          <label className="flex-1 min-w-[240px]">
            <span className="sr-only">Firm name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Firm name (as it should read to you, never to a client)"
              aria-invalid={!!error}
              aria-describedby={error ? "create-firm-error" : undefined}
              className="focus-ring w-full rounded border border-ink-100 bg-paper px-sm py-xs text-body-sm text-ink-900"
            />
          </label>
          <button type="button" onClick={create} disabled={saving} className="focus-ring rounded-lg bg-brass-600 px-md py-xs text-body-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Creating…" : "Create firm"}
          </button>
        </div>
        {error && (
          <p id="create-firm-error" role="alert" className="mt-xs text-body-sm text-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
