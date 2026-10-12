// =============================================================================
// components/blueprint/hub/HubFiles.tsx — the hub's project files, in Blueprint
// (K5a). A fork of components/assets/ProjectFilesPanel.tsx (Atelier, kept for
// its own surfaces): every asset grouped by kind, with a download link.
// Server-safe; renders nothing for an empty library.
// =============================================================================

import { groupAssetsForHub, KIND_ICON, KIND_LABEL, type AssetLite } from "@/lib/assets/types";

import { Icon } from "../Icon";

function formatBytes(b: number | null): string {
  if (b == null || !Number.isFinite(b)) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function HubFiles({ assets }: { assets: AssetLite[] }) {
  const groups = groupAssetsForHub(assets);
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="files-h" className="mx-auto max-w-[1344px] px-6 pb-16 lg:px-16" data-testid="hub-files">
      <h2 id="files-h" className="t-heading-md text-bp-ink-primary">
        Project files <span className="t-num-md text-bp-ink-tertiary">{assets.length}</span>
      </h2>
      {groups.map((g) => (
        <div key={g.title} className="mt-4">
          <h3 className="t-label-caps text-bp-ink-tertiary">{g.title.toUpperCase()}</h3>
          <ul className="mt-1">
            {g.assets.map((a) => (
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
        </div>
      ))}
    </section>
  );
}
