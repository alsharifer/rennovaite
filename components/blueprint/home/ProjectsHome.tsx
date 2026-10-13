"use client";

// =============================================================================
// components/blueprint/home/ProjectsHome.tsx — the Projects home (K8 #1,
// spec §6.1, Figma 53:65 desktop · 66:1343 phone).
//
// Header (eyebrow PROJECTS · display serif · counts · one Primary "New
// project") · controls that wrap, never scroll (text tabs with counts ·
// search · Show archived (N) · sort) · the table (thumbnail · name + scope ·
// stage as icon + label/caps · rev + date · estimate "≈ N*" + the weakest mark ·
// Next = the rail's first Attention / Blocked reason · updated) · the
// estimate footnote · Recent activity (≤ 6 plain rows). No KPI tiles.
//
// K10 (§6.12): a trailing "⋯" on every row (Open · Rename · Archive · Delete
// project…), "Recently deleted (N)" beside "Show archived" (?view=deleted —
// Restore / Delete now), and the undo toast after a delete (?undo=<id>).
//
// Tabs, search, archived and sort live in the URL (?tab=&q=&archived=1&sort=)
// so a link or a reload lands on the same view. Phone: a filter select + a
// search toggle, a full-width Primary and two-line rows.
// =============================================================================

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { formatAED, headlineSpokenText } from "@/lib/format/aed";
import { HOME_TABS, STAGE_ICON, STAGE_LABEL, age, inTab, sortRows, tabCounts, type HomeDeleted, type HomeRow, type HomeSort, type HomeTab, type HomeView } from "@/lib/projects/home";
import { tierLabel } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { DeleteNowDialog, ProjectActionsMenu, UndoToast } from "../projects/ProjectActions";
import { ProvenanceMark } from "../ProvenanceMark";
import { StateBlock } from "../StateBlock";

const SORTS: { key: HomeSort; label: string }[] = [
  { key: "updated", label: "Recently updated" },
  { key: "name", label: "Name" },
  { key: "estimate", label: "Estimate" },
];

function Estimate({ e, persona }: { e: NonNullable<HomeRow["estimate"]>; persona: "firm" | "owner" }) {
  return (
    <span className="inline-flex items-center justify-end gap-2" data-home-estimate={e.total}>
      <span aria-hidden="true" className="t-num-md text-bp-ink-primary">
        {e.estimate ? "≈ " : ""}
        {formatAED(e.total)}
        {e.excludes ? "*" : ""}
      </span>
      {e.tier ? <ProvenanceMark tier={e.tier} /> : null}
      <span className="sr-only">
        {headlineSpokenText(e.total, { estimate: e.estimate, excludedLines: e.excludes })}
        {e.tier ? `, ${tierLabel(e.tier, persona)}` : ""}
      </span>
    </span>
  );
}

function Thumb({ src }: { src: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a stored render, already sized by Storage
    <img src={src} alt="" className="h-[43px] w-16 border border-bp-line-hairline object-cover" loading="lazy" />
  ) : (
    <span aria-hidden="true" className="block h-[43px] w-16 border border-bp-line-hairline bg-bp-surface-sunken" />
  );
}

function Stage({ row }: { row: HomeRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-bp-ink-secondary">
      <Icon name={STAGE_ICON[row.stage]} className="text-[20px]" />
      <span className="t-label-caps">{STAGE_LABEL[row.stage]}</span>
    </span>
  );
}

function Next({ row, compact = false }: { row: HomeRow; compact?: boolean }) {
  if (!row.next) {
    return compact ? null : (
      <span className="block">
        <span className="t-label-caps block text-bp-ink-tertiary">—</span>
        <span className="t-body-sm block text-bp-ink-tertiary">Nothing waiting on you</span>
      </span>
    );
  }
  const n = row.next;
  return (
    <Link href={n.href} className="group block outline-offset-2" aria-label={`${n.step} — ${n.state === "blocked" ? "blocked" : "needs attention"}: ${n.reason}`}>
      {compact ? null : (
        <span className="flex items-center gap-1.5 text-bp-ink-primary">
          <Icon name={n.state === "blocked" ? "lock" : "flag"} className="text-[20px]" />
          <span className="t-label-caps">{n.step}</span>
        </span>
      )}
      <span className={`t-body-sm flex items-center gap-1.5 text-bp-ink-primary group-hover:underline ${compact ? "" : "pl-0"}`}>
        {compact ? <Icon name={n.state === "blocked" ? "lock" : "flag"} className="text-[18px]" /> : null}
        {n.reason}
      </span>
    </Link>
  );
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
const longTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dubai" });

/** Recently deleted (77:2905): the 30-day rule, then each project with Restore / Delete now. */
function RecentlyDeleted({ rows, now }: { rows: HomeDeleted[]; now: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<HomeDeleted | null>(null);
  async function restore(id: string) {
    setBusy(id);
    const res = await fetch(`/api/projects/${id}/restore`, { method: "POST" }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Restore failed. Try again.");
    router.refresh();
  }
  return (
    <section aria-label="Recently deleted" className="mt-6" data-recently-deleted>
      <p className="t-body-sm flex items-start gap-3 bg-bp-surface-sunken px-4 py-3.5 text-bp-ink-primary">
        <Icon name="schedule" size={20} />
        Deleted projects are hidden from everyone on them. Each is removed permanently 30 days after it was deleted — including uploaded drawings, photos and renders.
      </p>
      {error ? (
        <p role="alert" className="surface-inverse t-body-sm mt-3 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="t-body-sm mt-6 text-bp-ink-secondary">Nothing deleted in the last 30 days.</p>
      ) : (
        <div className="relative mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse" aria-label="Recently deleted projects">
            <thead>
              <tr className="bg-bp-surface-sunken text-left">
                <th scope="col" className="t-label-caps px-3 py-2.5 text-bp-ink-tertiary">PROJECT</th>
                <th scope="col" className="t-label-caps px-2 py-2.5 text-bp-ink-tertiary">DELETED</th>
                <th scope="col" className="t-label-caps px-2 py-2.5 text-bp-ink-tertiary">BY</th>
                <th scope="col" className="t-label-caps px-2 py-2.5 text-bp-ink-tertiary">REMOVED PERMANENTLY</th>
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const days = Math.max(0, Math.ceil((Date.parse(r.purgeOn) - now) / 86_400_000));
                return (
                  <tr key={r.id} className="border-b border-bp-line-hairline align-middle" data-deleted-project={r.id}>
                    <td className="t-heading-sm px-3 py-3.5 text-bp-ink-primary">{r.name}</td>
                    <td className="t-label-md whitespace-nowrap px-2 py-3.5 font-bp-mono text-bp-ink-secondary">
                      {longDate(r.deletedAt)} · {longTime(r.deletedAt)}
                    </td>
                    <td className="t-body-sm px-2 py-3.5 text-bp-ink-secondary">{r.deletedBy ?? "—"}</td>
                    <td className="t-label-md whitespace-nowrap px-2 py-3.5 font-bp-mono text-bp-ink-secondary">
                      {longDate(r.purgeOn)} · in {days} day{days === 1 ? "" : "s"}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex items-center justify-end gap-5">
                        <Button kind="secondary" onClick={() => void restore(r.id)} disabled={busy === r.id ? { reason: "Restoring…", reasonId: `restoring-${r.id}`, showReason: false } : false} testId="restore-project">
                          {busy === r.id ? "Restoring…" : "Restore"}
                        </Button>
                        {r.canDeleteNow ? (
                          <Button kind="quiet" onClick={() => setPurging(r)} testId="delete-now">
                            Delete now
                          </Button>
                        ) : null}
                        {busy === r.id ? (
                          <span id={`restoring-${r.id}`} className="sr-only">
                            Restoring…
                          </span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="t-label-caps mt-4 text-bp-ink-tertiary">
        &ldquo;DELETE NOW&rdquo; ONLY FOR THE PROJECT CREATOR (OWNER PROJECTS) OR A FIRM ADMIN (FIRM PROJECTS); IT ASKS FOR THE NAME AGAIN. RESTORE PUTS THE PROJECT BACK EXACTLY AS IT WAS, SAME MEMBERS.
      </p>
      {purging ? <DeleteNowDialog project={purging} open onClose={() => setPurging(null)} /> : null}
    </section>
  );
}

export function ProjectsHome({ view, persona, now }: { view: HomeView; persona: "firm" | "owner"; now: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tab = (HOME_TABS.find((t) => t.key === sp.get("tab"))?.key ?? "all") as HomeTab;
  const sort = (SORTS.find((s) => s.key === sp.get("sort"))?.key ?? "updated") as HomeSort;
  const showArchived = sp.get("archived") === "1";
  const showDeleted = sp.get("view") === "deleted";
  const undoId = sp.get("undo");
  const undoName = undoId ? (view.deleted.find((d) => d.id === undoId)?.name ?? null) : null;
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [phoneSearch, setPhoneSearch] = useState(!!sp.get("q"));

  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "" || (k === "tab" && v === "all") || (k === "sort" && v === "updated")) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const go = (patch: Record<string, string | null>) => router.replace(href(patch), { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissing only drops ?undo from the current URL
  const dismissUndo = useCallback(() => go({ undo: null }), [sp]);
  const toast = undoId && undoName ? <UndoToast key={undoId} projectId={undoId} name={undoName} onDone={dismissUndo} /> : null;

  const pool = useMemo(() => view.rows.filter((r) => (showArchived ? r.archived : !r.archived)), [view.rows, showArchived]);
  const counts = useMemo(() => tabCounts(pool), [pool]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () => sortRows(pool.filter((r) => inTab(r, tab) && (!needle || `${r.name} ${r.scope ?? ""}`.toLowerCase().includes(needle))), sort),
    [pool, tab, needle, sort],
  );

  const c = view.counts;
  const countsLine = [`${c.active} active`, c.onHold ? `${c.onHold} on hold` : null, `${c.completed} completed`].filter(Boolean).join(" · ");

  if (view.rows.length === 0 && view.deleted.length === 0) {
    return (
      <div className="mx-auto max-w-[1344px] px-4 py-8 md:px-12" data-home>
        <p className="t-label-caps text-bp-brass-text">PROJECTS</p>
        <h1 className="t-display-serif mt-2 text-bp-ink-primary">Projects</h1>
        <div className="mt-8 max-w-[720px]">
          <StateBlock kind="empty" icon="folder_open" title="No projects yet" actions={<Button kind="primary" href="/project/new">New project</Button>}>
            Start with your floor plan — we read it, measure every room and price the work from it.
          </StateBlock>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1344px] px-4 pb-12 pt-6 md:px-12 md:pt-8" data-home>
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="min-w-0 flex-1">
          <p className="t-label-caps hidden text-bp-brass-text md:block">PROJECTS</p>
          {/* Display serif on desktop (one per screen); the phone frame uses heading/lg. */}
          <h1 className="t-display-serif mt-1.5 hidden text-bp-ink-primary md:block">Projects</h1>
          <h1 className="t-heading-lg text-bp-ink-primary md:hidden">Projects</h1>
          <p className="t-label-md mt-1.5 font-bp-mono text-bp-ink-tertiary">{countsLine}</p>
        </div>
        <div className="hidden md:block">
          <Button kind="primary" href="/project/new">
            New project
          </Button>
        </div>
      </div>

      {/* Controls — desktop / tablet: tabs · search · archived · sort; they wrap, never scroll. */}
      <div className="mt-7 hidden flex-wrap items-center gap-x-6 gap-y-3 border-b border-bp-line-hairline md:flex">
        <nav aria-label="Filter projects by stage" className="-mb-px min-w-0 flex-1">
          <ul className="flex flex-wrap gap-x-5">
            {HOME_TABS.map((t) => {
              const on = t.key === tab;
              return (
                <li key={t.key}>
                  <Link
                    href={href({ tab: t.key })}
                    replace
                    scroll={false}
                    aria-current={on ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 py-2.5 outline-offset-2 ${on ? "t-nav-item-active border-bp-brass text-bp-ink-primary" : "t-body-sm border-transparent text-bp-ink-secondary hover:text-bp-ink-primary"}`}
                  >
                    {t.label}
                    <span className="t-label-md text-bp-ink-tertiary">{counts[t.key]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <label className="mb-2 flex w-[260px] items-center gap-2 border border-bp-line-control bg-bp-surface-base px-2.5 py-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bp-focus-ring">
          <Icon name="search" className="text-[20px] text-bp-ink-tertiary" />
          <span className="sr-only">Search projects</span>
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              go({ q: e.target.value });
            }}
            placeholder="Search projects"
            className="t-body-sm min-w-0 flex-1 bg-transparent text-bp-ink-primary outline-none placeholder:text-bp-ink-tertiary"
          />
        </label>
        {view.deleted.length > 0 || showDeleted ? (
          <Link href={href({ view: showDeleted ? null : "deleted", archived: null })} replace scroll={false} aria-current={showDeleted ? "page" : undefined} className={`mb-2 inline-flex min-h-11 items-center gap-1.5 border-b-2 ${showDeleted ? "t-nav-item-active border-bp-brass text-bp-ink-primary" : "t-body-sm border-transparent text-bp-ink-secondary hover:text-bp-ink-primary"}`} data-testid="recently-deleted-link">
            <Icon name="delete" className="text-[20px]" />
            Recently deleted <span className="t-label-md text-bp-ink-tertiary">{view.deleted.length}</span>
          </Link>
        ) : null}
        {c.archived > 0 || showArchived ? (
          <Link href={href({ archived: showArchived ? null : "1" })} replace scroll={false} aria-pressed={showArchived} className="t-body-sm mb-2 inline-flex min-h-11 items-center gap-1.5 text-bp-ink-secondary hover:text-bp-ink-primary">
            <Icon name="inventory_2" className="text-[20px]" />
            {showArchived ? "Hide archived" : `Show archived (${c.archived})`}
          </Link>
        ) : null}
        <label className="mb-2 inline-flex items-center gap-1.5">
          <span className="t-label-caps text-bp-ink-tertiary">SORT</span>
          <select value={sort} onChange={(e) => go({ sort: e.target.value })} className="t-body-sm min-h-9 bg-transparent pr-1 text-bp-ink-primary">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Controls — phone: filter select + search toggle (66:1343). */}
      <div className="mt-5 flex gap-2 md:hidden">
        <label className="flex-1">
          <span className="sr-only">Filter projects by stage</span>
          <select value={tab} onChange={(e) => go({ tab: e.target.value })} className="t-body-md min-h-11 w-full border border-bp-line-control bg-bp-surface-base px-3 text-bp-ink-primary">
            {HOME_TABS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} · {counts[t.key]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setPhoneSearch((v) => !v)} aria-expanded={phoneSearch} aria-label="Search projects" className="flex min-h-11 w-11 items-center justify-center border border-bp-line-control text-bp-ink-secondary">
          <Icon name="search" className="text-[20px]" />
        </button>
      </div>
      {phoneSearch ? (
        <label className="mt-2 flex items-center gap-2 border border-bp-line-control px-2.5 py-2 md:hidden">
          <span className="sr-only">Search projects</span>
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              go({ q: e.target.value });
            }}
            placeholder="Search projects"
            className="t-body-md min-w-0 flex-1 bg-transparent text-bp-ink-primary outline-none placeholder:text-bp-ink-tertiary"
          />
        </label>
      ) : null}
      {/* Phone: the one Primary, full width under the filters (66:1343). */}
      <div className="mt-4 md:hidden">
        <Button kind="primary" href="/project/new" className="w-full justify-center">
          New project
        </Button>
      </div>

      {/* K10: the phone reaches Recently deleted under the filters. */}
      {view.deleted.length > 0 || showDeleted ? (
        <Link href={href({ view: showDeleted ? null : "deleted", archived: null })} replace scroll={false} className="t-body-sm mt-3 inline-flex min-h-11 items-center gap-1.5 text-bp-ink-secondary md:hidden">
          <Icon name="delete" className="text-[20px]" />
          {showDeleted ? "Back to projects" : `Recently deleted (${view.deleted.length})`}
        </Link>
      ) : null}

      {/* Table — desktop / tablet */}
      {showDeleted ? (
        <RecentlyDeleted rows={view.deleted} now={now} />
      ) : rows.length === 0 ? (
        <p className="t-body-sm mt-6 text-bp-ink-secondary">No projects match {needle ? `“${q.trim()}”` : "this filter"}.</p>
      ) : (
        <>
          <table className="mt-7 hidden w-full border-collapse md:table" aria-label="Projects" data-testid="home-table">
            <thead>
              <tr className="bg-bp-surface-sunken text-left">
                <th scope="col" className="w-[88px] px-3 py-2.5">
                  <span className="sr-only">Latest locked view</span>
                </th>
                <th scope="col" className="t-label-caps px-2 py-2.5 text-bp-ink-tertiary">PROJECT</th>
                <th scope="col" className="t-label-caps w-[134px] px-2 py-2.5 text-bp-ink-tertiary">STAGE</th>
                <th scope="col" className="t-label-caps hidden w-[120px] px-2 py-2.5 text-bp-ink-tertiary lg:table-cell">REVISION</th>
                <th scope="col" className="t-label-caps w-[184px] px-2 py-2.5 text-right text-bp-ink-tertiary">ESTIMATE · AED</th>
                <th scope="col" className="t-label-caps px-2 py-2.5 text-bp-ink-tertiary">NEXT</th>
                <th scope="col" className="t-label-caps hidden w-[72px] px-3 py-2.5 text-right text-bp-ink-tertiary lg:table-cell">UPDATED</th>
                <th scope="col" className="w-12 px-2 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-bp-line-hairline align-middle hover:bg-bp-surface-raised" data-project={r.id}>
                  <td className="px-3 py-3">
                    <Thumb src={r.thumb} />
                  </td>
                  <td className="px-2 py-3">
                    <Link href={`/project/${r.id}`} className="t-heading-sm block text-bp-ink-primary hover:underline">
                      {r.name}
                    </Link>
                    {r.scope ? <span className="t-body-sm block text-bp-ink-secondary">{r.scope}</span> : null}
                  </td>
                  <td className="px-2 py-3">
                    <Stage row={r} />
                  </td>
                  <td className="t-label-md hidden whitespace-nowrap px-2 py-3 font-bp-mono text-bp-ink-secondary lg:table-cell">{r.rev ? `rev ${r.rev.n} · ${r.rev.date}` : "—"}</td>
                  <td className="px-2 py-3 text-right">{r.estimate ? <Estimate e={r.estimate} persona={persona} /> : <span className="t-body-sm text-bp-ink-tertiary">No BoQ yet</span>}</td>
                  <td className="px-2 py-3">
                    <Next row={r} />
                  </td>
                  <td className="t-label-md hidden px-3 py-3 text-right font-bp-mono text-bp-ink-tertiary lg:table-cell">{age(r.updatedAt, now)}</td>
                  <td className="px-2 py-3 text-right">
                    <ProjectActionsMenu project={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phone rows (66:1343): thumbnail · name / STAGE + estimate / next. */}
          <ul className="mt-5 md:hidden" aria-label="Projects">
            {rows.map((r) => (
              <li key={r.id} className="flex gap-3 border-b border-bp-line-hairline py-3">
                <Thumb src={r.thumb} />
                <div className="min-w-0 flex-1">
                  <Link href={`/project/${r.id}`} className="t-heading-sm block truncate text-bp-ink-primary">
                    {r.name}
                  </Link>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
                    <span className="t-label-caps text-bp-ink-secondary">{STAGE_LABEL[r.stage]}</span>
                    {r.estimate ? <Estimate e={r.estimate} persona={persona} /> : <span className="t-body-sm text-bp-ink-tertiary">No BoQ yet</span>}
                  </span>
                  <span className="mt-0.5 block">
                    <Next row={r} compact />
                  </span>
                </div>
                <ProjectActionsMenu project={r} />
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="t-label-md mt-4 font-bp-mono text-bp-ink-tertiary">
        ≈ estimate, incl. contingency and VAT · * excludes lines still to be priced · the mark is the weakest counted input — the same mark the project shows
      </p>

      {view.activity.length ? (
        <section aria-labelledby="activity-h" className="mt-10">
          <h2 id="activity-h" className="t-heading-md border-b-2 border-bp-line-strong pb-2.5 text-bp-ink-primary">
            Recent activity
          </h2>
          <ul>
            {view.activity.map((a, i) => (
              <li key={`${a.projectId}-${a.at}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-bp-line-hairline py-2.5 md:flex">
                <span className="t-body-sm col-span-2 min-w-0 text-bp-ink-primary md:flex-1">{a.text}</span>
                <Link href={`/project/${a.projectId}`} className="t-body-sm min-w-0 truncate text-bp-ink-secondary hover:underline">
                  {a.project}
                </Link>
                <span className="t-label-md w-12 text-right font-bp-mono text-bp-ink-tertiary">{age(a.at, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {toast}
    </div>
  );
}
