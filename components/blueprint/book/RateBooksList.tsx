"use client";

// =============================================================================
// components/blueprint/book/RateBooksList.tsx — /firms when the caller is in
// more than one firm, or none (K8 #10, spec §6.8, Figma 63:1094). One row per
// firm the caller belongs to (never anyone else's — /api/firms answers with
// the caller's firms only): its book's active entries, whether it is reviewed,
// and its last quote import. "Create firm" opens the form in place; the new
// firm's book opens on creation.
// =============================================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "../Button";
import { StateBlock } from "../StateBlock";

export interface RateBookRow {
  id: string;
  name: string;
  entries: number;
  /** "3 Oct 2026", or null while the book is a draft. */
  reviewed: string | null;
  /** "2 Oct 2026 · 12 lines", or null when no quote was imported. */
  lastImport: string | null;
}

export function RateBooksList({ rows }: { rows: RateBookRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(rows.length === 0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the firm a name.");
      input.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/firms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: trimmed }) });
      const body = (await res.json().catch(() => ({}))) as { firm?: { id: string }; error?: string; code?: string };
      if (!res.ok || !body.firm) {
        setError(body.code === "conflict" ? `A firm named “${trimmed}” already exists.` : "The firm could not be created. Try again.");
        return;
      }
      router.push(`/firms/${body.firm.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-rate-books>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="t-label-caps text-bp-brass-text">RATE BOOKS</p>
          <h1 className="t-heading-lg mt-2 text-bp-ink-primary">Your firms’ rate books</h1>
          <p className="t-body-md mt-2 max-w-[720px] text-bp-ink-secondary">One book per firm. Its rates price that firm’s projects only, and reach a client as “contractor rate book” — never as the firm’s name.</p>
        </div>
        {!creating ? (
          <Button
            kind="secondary"
            onClick={() => {
              setCreating(true);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            Create firm
          </Button>
        ) : null}
      </div>

      {creating ? (
        <section aria-labelledby="create-h" className="mt-6 max-w-[720px] border border-bp-line-hairline p-4">
          <h2 id="create-h" className="t-label-caps text-bp-ink-tertiary">
            CREATE A FIRM
          </h2>
          <p className="t-body-sm mt-1 text-bp-ink-secondary">You become its first member. The name is yours to read — a client never sees it.</p>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <label className="min-w-[240px] flex-1">
              <span className="t-label-md block text-bp-ink-secondary">Firm name</span>
              <input
                ref={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                aria-invalid={!!error}
                aria-describedby={error ? "create-firm-error" : undefined}
                className="t-body-sm mt-1 h-9 w-full rounded-none border border-bp-line-control bg-bp-surface-raised px-3 text-bp-ink-primary"
              />
            </label>
            <div className="flex gap-3 pt-5">
              <Button kind="primary" onClick={create} disabled={saving ? { reason: "Creating the firm…", reasonId: "create-firm-busy", showReason: true } : false}>
                Create firm
              </Button>
              {rows.length ? (
                <Button kind="quiet" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p id="create-firm-error" role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-3 py-2 text-bp-alert-ink">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-7">
        {rows.length === 0 ? (
          <div className="max-w-[720px]">
            <StateBlock kind="empty" icon="menu_book" title="You are not in a firm yet">
              Create one above to keep your own rates. A firm’s book prices only its own projects.
            </StateBlock>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse" data-testid="firm-list">
              <thead>
                <tr className="bg-bp-surface-sunken">
                  <th scope="col" className="t-label-caps px-3 py-2.5 text-left font-normal text-bp-ink-tertiary">FIRM</th>
                  <th scope="col" className="t-label-caps px-3 py-2.5 text-right font-normal text-bp-ink-tertiary">ENTRIES</th>
                  <th scope="col" className="t-label-caps px-3 py-2.5 text-left font-normal text-bp-ink-tertiary">BOOK REVIEWED</th>
                  <th scope="col" className="t-label-caps px-3 py-2.5 text-left font-normal text-bp-ink-tertiary">LAST QUOTE IMPORT</th>
                  <th scope="col" className="px-3 py-2.5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-bp-line-hairline">
                    <th scope="row" className="t-nav-item-active px-3 py-3 text-left text-bp-ink-primary">
                      {r.name}
                    </th>
                    <td className="t-num-sm px-3 py-3 text-right text-bp-ink-primary">{r.entries.toLocaleString("en-US")}</td>
                    <td className={`t-body-sm px-3 py-3 ${r.reviewed ? "text-bp-ink-primary" : "text-bp-ink-tertiary"}`}>{r.reviewed ?? "Not reviewed"}</td>
                    <td className={`t-body-sm px-3 py-3 ${r.lastImport ? "text-bp-ink-primary" : "text-bp-ink-tertiary"}`}>{r.lastImport ?? "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <Link href={`/firms/${r.id}`} className="t-body-sm text-bp-ink-primary underline-offset-4 hover:underline">
                        Open<span className="sr-only"> {r.name}’s rate book</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
