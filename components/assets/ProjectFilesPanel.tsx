// =============================================================================
// components/assets/ProjectFilesPanel.tsx — hub "Project files" section.
//
// Presentational (server-safe): lists every project asset grouped by kind with
// a download link. Renders nothing when there are no assets so the hub is
// unchanged for projects with an empty library (or before migration 024).
// =============================================================================

import { groupAssetsForHub, KIND_ICON, KIND_LABEL, type AssetLite } from "@/lib/assets/types";

function formatBytes(b: number | null): string {
  if (b == null || !Number.isFinite(b)) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectFilesPanel({ assets }: { assets: AssetLite[] }) {
  const groups = groupAssetsForHub(assets);
  if (groups.length === 0) return null;

  return (
    <section className="mt-xl rounded-xl border border-ink-100 bg-paper p-lg">
      <p className="label-caps mb-md text-ink-500">Project files · {assets.length}</p>
      <div className="flex flex-col gap-lg">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-sm font-body-sm text-body-sm font-semibold text-ink-900">
              {group.title}
            </p>
            <ul className="flex flex-col gap-xs">
              {group.assets.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-md rounded-lg border border-ink-100 bg-canvas px-md py-sm"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-fixed/50 text-brass-600">
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                      {KIND_ICON[a.kind]}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body-sm text-body-sm text-ink-900">
                      {a.filename?.trim() || KIND_LABEL[a.kind]}
                    </p>
                    <p className="font-mono text-[11px] text-ink-500">
                      {KIND_LABEL[a.kind]}
                      {formatBytes(a.bytes) ? ` · ${formatBytes(a.bytes)}` : ""}
                    </p>
                  </div>
                  <a
                    href={a.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring flex h-9 shrink-0 items-center gap-xs rounded-lg border border-ink-100 bg-paper px-md font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container-low"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                      download
                    </span>
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
