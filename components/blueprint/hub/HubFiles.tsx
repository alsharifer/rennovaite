"use client";

// =============================================================================
// components/blueprint/hub/HubFiles.tsx — the project's files on the Overview /
// hub (K5a; K10 #9). A fork of components/assets/ProjectFilesPanel.tsx
// (Atelier, kept for its own surfaces).
//
// K10: on the BODY grid — rendered in the page's main column (OwnerOverview /
// HubScreen take it as their `files` slot), no longer a full-width block below
// the page — and short: the first FILES_SHOWN files (in the kind order of
// groupAssetsForHub; each row names its kind) and "Show all N" for the rest.
// Renders nothing for an empty library.
// =============================================================================

import { useId, useState } from "react";

import { groupAssetsForHub, KIND_ICON, KIND_LABEL, type AssetLite } from "@/lib/assets/types";

import { Icon } from "../Icon";

export const FILES_SHOWN = 5;

function formatBytes(b: number | null): string {
  if (b == null || !Number.isFinite(b)) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function HubFiles({ assets, className = "mt-10" }: { assets: AssetLite[]; className?: string }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const ordered = groupAssetsForHub(assets).flatMap((g) => g.assets);
  if (ordered.length === 0) return null;
  const shown = all ? ordered : ordered.slice(0, FILES_SHOWN);
  const more = ordered.length - FILES_SHOWN;
  return (
    <section aria-labelledby="files-h" className={className} data-testid="hub-files">
      <div className="flex items-baseline gap-4 border-b-2 border-bp-line-strong pb-2.5">
        <h2 id="files-h" className="t-heading-md flex-1 text-bp-ink-primary">
          Project files
        </h2>
        <p className="t-label-md font-bp-mono text-bp-ink-tertiary">
          {ordered.length} {ordered.length === 1 ? "file" : "files"}
        </p>
      </div>
      <ul id={listId} className="mt-1" data-files-shown={shown.length}>
        {shown.map((a) => (
          <li key={a.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b border-bp-line-hairline py-3">
            <Icon name={KIND_ICON[a.kind]} size={20} className="text-bp-ink-secondary" />
            <span className="min-w-0">
              <span className="t-body-sm block truncate text-bp-ink-primary">{a.filename?.trim() || KIND_LABEL[a.kind]}</span>
              <span className="t-label-md block text-bp-ink-secondary">
                {KIND_LABEL[a.kind]}
                {formatBytes(a.bytes) ? ` · ${formatBytes(a.bytes)}` : ""}
              </span>
            </span>
            <a
              href={a.url}
              download
              target="_blank"
              rel="noreferrer"
              className="t-label-md inline-flex min-h-9 items-center gap-1 text-bp-ink-primary underline decoration-bp-line-control underline-offset-2 hover:decoration-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
            >
              <Icon name="download" size={16} />
              Download<span className="sr-only"> {a.filename?.trim() || KIND_LABEL[a.kind]}</span>
            </a>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((v) => !v)}
          className="t-nav-item-active mt-3 inline-flex min-h-11 items-center gap-1.5 text-bp-ink-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
          data-testid="files-show-all"
        >
          <Icon name={all ? "expand_less" : "expand_more"} size={18} />
          {all ? "Show fewer" : `Show all ${ordered.length}`}
        </button>
      ) : null}
    </section>
  );
}
