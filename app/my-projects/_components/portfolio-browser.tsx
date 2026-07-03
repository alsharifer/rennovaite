"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  ALL_PHASES,
  type Phase,
  type PortfolioProject,
  type SortKey,
} from "./portfolio-types";

const PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

type Props = {
  projects: PortfolioProject[];
  counts: Record<"all" | Phase, number>;
  filter: Phase[];
  sort: SortKey;
  initialView: "grid" | "list";
};

export function PortfolioBrowser({
  projects,
  counts,
  filter,
  sort,
  initialView,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const filterSet = useMemo(() => new Set(filter), [filter]);
  const [view, setView] = useState<"grid" | "list">(initialView);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Debounce the search input (250ms) — client-side filter, no URL sync per
  // spec.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Apply the in-memory search filter.
  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const blob =
        `${p.name} ${p.city ?? ""} ${p.phase}`.toLowerCase();
      return blob.includes(q);
    });
  }, [projects, debouncedSearch]);

  // Treat any selected id that's no longer in `projects` as deselected.
  // Derive at render time instead of resetting via an effect (which trips
  // react-hooks/set-state-in-effect).
  const projectIdSet = useMemo(
    () => new Set(projects.map((p) => p.id)),
    [projects],
  );
  const effectiveSelected = useMemo(() => {
    const next = new Set<string>();
    for (const id of selected) if (projectIdSet.has(id)) next.add(id);
    return next;
  }, [selected, projectIdSet]);

  // Active counts strip for the header caption.
  const headerCaption = useMemo(() => {
    const active = ALL_PHASES.filter(
      (p) => p !== "On hold" && p !== "Completed",
    ).reduce((sum, p) => sum + counts[p], 0);
    return `${active} active · ${counts["On hold"]} on hold · ${counts.Completed} completed`;
  }, [counts]);

  // ----- URL helpers ----------------------------------------------------
  const buildHref = useCallback(
    (overrides: { filter?: Phase[]; sort?: SortKey; view?: "grid" | "list" }) => {
      const next = new URLSearchParams(sp.toString());
      if (overrides.filter !== undefined) {
        if (overrides.filter.length === 0) next.delete("filter");
        else next.set("filter", overrides.filter.join(","));
      }
      if (overrides.sort !== undefined) {
        if (overrides.sort === "updated") next.delete("sort");
        else next.set("sort", overrides.sort);
      }
      if (overrides.view !== undefined) {
        if (overrides.view === "grid") next.delete("view");
        else next.set("view", overrides.view);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, sp],
  );

  const navigate = useCallback(
    (overrides: Parameters<typeof buildHref>[0]) => {
      router.replace(buildHref(overrides), { scroll: false });
    },
    [buildHref, router],
  );

  const toggleChip = useCallback(
    (phase: Phase | "all") => {
      if (phase === "all") {
        navigate({ filter: [] });
        return;
      }
      const next = new Set(filterSet);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      navigate({ filter: [...next] });
    },
    [filterSet, navigate],
  );

  const setSort = useCallback(
    (k: SortKey) => navigate({ sort: k }),
    [navigate],
  );

  const setViewWithUrl = useCallback(
    (v: "grid" | "list") => {
      setView(v);
      navigate({ view: v });
    },
    [navigate],
  );

  // ----- Selection helpers ---------------------------------------------
  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Pagination (list view only — spec defaults to 12/page).
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Clamp at render time so a shrinking result set can't leave us on a
  // non-existent page (replaces the previous setPage-in-effect).
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const pageStart = (clampedPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, visible.length);
  const paged = view === "list" ? visible.slice(pageStart, pageEnd) : visible;

  return (
    <div className="mx-auto -mx-12 -mt-12 max-w-none">
      {/* HEADER (96px tall, hairline bottom) ----------------------------- */}
      <header className="border-b border-ink-100 bg-paper">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-lg px-12 py-lg">
          <div>
            <p className="label-caps mb-xs tracking-widest text-brass-600">
              Residence archive
            </p>
            <h1
              className="font-display italic text-ink-900"
              style={{ fontSize: "56px", lineHeight: "64px" }}
            >
              Your villas.
            </h1>
            <p className="mt-xs font-body text-body-md text-on-surface-variant">
              {headerCaption}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-md">
            <label
              className="hidden h-10 w-80 items-center gap-sm rounded-full border border-ink-100 bg-paper px-md text-on-surface-variant focus-within:border-brass-600 md:flex"
              aria-label="Search projects"
            >
              <span
                className="material-symbols-outlined text-[20px]"
                aria-hidden="true"
              >
                search
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by villa name, location, or BoQ ref…"
                className="h-full flex-1 bg-transparent font-body text-body-sm text-ink-900 placeholder:text-on-surface-variant focus:outline-none"
              />
            </label>
            <Link
              href="/project/new"
              className="focus-ring flex h-10 shrink-0 items-center gap-sm rounded-lg bg-brass-600 px-md font-body text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
            >
              <span
                className="material-symbols-outlined text-[18px]"
                aria-hidden="true"
              >
                add
              </span>
              New project
            </Link>
          </div>
        </div>
      </header>

      {/* FILTER & SORT BAR (64px tall, hairline bottom) ------------------- */}
      <div className="border-b border-ink-100 bg-paper">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-lg px-12 py-md">
          {/* Chips ------------------------------------------------------- */}
          <div className="flex flex-1 items-center gap-xs overflow-x-auto">
            <Chip
              active={filterSet.size === 0}
              label={`All (${counts.all})`}
              onClick={() => toggleChip("all")}
            />
            {ALL_PHASES.map((p) => (
              <Chip
                key={p}
                active={filterSet.has(p)}
                label={`${p} (${counts[p]})`}
                onClick={() => toggleChip(p)}
              />
            ))}
          </div>
          {/* Sort + view toggle ----------------------------------------- */}
          <div className="flex shrink-0 items-center gap-sm">
            <SortDropdown value={sort} onChange={setSort} />
            <div
              className="flex items-center gap-0 overflow-hidden rounded-lg border border-ink-100 bg-paper"
              role="group"
              aria-label="View mode"
            >
              <ViewToggleButton
                active={view === "grid"}
                onClick={() => setViewWithUrl("grid")}
                icon="grid_view"
                label="Grid view"
              />
              <ViewToggleButton
                active={view === "list"}
                onClick={() => setViewWithUrl("list")}
                icon="view_list"
                label="List view"
              />
            </div>
          </div>
        </div>
      </div>

      {/* BODY ----------------------------------------------------------- */}
      <div className="mx-auto max-w-[1440px] px-12 py-xl pb-3xl">
        {visible.length === 0 && projects.length === 0 ? (
          <EmptyState />
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-100 bg-paper p-3xl text-center">
            <p className="font-body text-body-md text-on-surface-variant">
              No villas match this filter — try clearing it.
            </p>
          </div>
        ) : view === "grid" ? (
          <GridView
            projects={visible}
            selected={effectiveSelected}
            onToggleSelected={toggleSelected}
          />
        ) : (
          <ListView
            projects={paged}
            selected={effectiveSelected}
            onToggleSelected={toggleSelected}
            page={clampedPage}
            totalPages={totalPages}
            pageStart={pageStart}
            pageEnd={pageEnd}
            total={visible.length}
            onPage={setPage}
          />
        )}
      </div>

      {/* BULK ACTIONS STRIP --------------------------------------------- */}
      <AnimatePresence>
        {effectiveSelected.size > 0 && (
          <motion.div
            key="bulk-strip"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="fixed bottom-0 left-60 right-0 z-30 h-16 border-t border-ink-100 bg-paper shadow-level-1"
          >
            <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-lg px-12">
              <p className="label-caps text-ink-900">
                {effectiveSelected.size} selected
              </p>
              <div className="flex items-center gap-md">
                <BulkButton icon="archive" label="Archive" />
                <BulkButton icon="picture_as_pdf" label="Export BoQs" />
                <BulkButton icon="share" label="Share" />
                <button
                  type="button"
                  onClick={clearSelection}
                  className="focus-ring font-body text-body-sm font-semibold text-on-surface-variant hover:text-ink-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "focus-ring h-8 shrink-0 rounded-full border px-md font-body text-body-sm font-semibold transition-colors",
        active
          ? "border-brass-600 bg-brass-600 text-on-primary"
          : "border-ink-100 bg-paper text-on-surface-variant hover:border-brass-600 hover:text-ink-900",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sort dropdown
// ---------------------------------------------------------------------------

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Recently updated",
  budget: "Largest budget",
  pipeline: "Furthest in pipeline",
  name: "Name A→Z",
};

function SortDropdown({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex h-10 items-center gap-sm rounded-lg border border-ink-100 bg-paper px-md font-body text-body-sm text-ink-900 hover:border-brass-600"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="label-caps text-ink-500">Sort by</span>
        <span>{SORT_LABELS[value]}</span>
        <span
          className="material-symbols-outlined text-[18px] text-on-surface-variant"
          aria-hidden="true"
        >
          expand_more
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-lg border border-ink-100 bg-paper shadow-level-1"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-md py-sm text-left font-body text-body-sm hover:bg-surface-container-low",
                k === value ? "text-brass-600" : "text-ink-900",
              )}
            >
              {SORT_LABELS[k]}
              {k === value && (
                <span
                  className="material-symbols-outlined text-[16px]"
                  aria-hidden="true"
                >
                  check
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View-toggle button
// ---------------------------------------------------------------------------

function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "focus-ring flex h-10 w-10 items-center justify-center transition-colors",
        active
          ? "bg-primary-fixed text-on-primary-fixed"
          : "bg-paper text-on-surface-variant hover:text-ink-900",
      )}
    >
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grid view
// ---------------------------------------------------------------------------

function GridView({
  projects,
  selected,
  onToggleSelected,
}: {
  projects: PortfolioProject[];
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <GridCard
          key={p.id}
          project={p}
          isSelected={selected.has(p.id)}
          onToggleSelected={() => onToggleSelected(p.id)}
        />
      ))}
      <AddCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid card
// ---------------------------------------------------------------------------

function GridCard({
  project,
  isSelected,
  onToggleSelected,
}: {
  project: PortfolioProject;
  isSelected: boolean;
  onToggleSelected: () => void;
}) {
  const pill = PHASE_PILL[project.phase];
  return (
    <div
      data-selected={isSelected || undefined}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-paper transition-all duration-200 hover:-translate-y-0.5 hover:shadow-level-1",
        isSelected ? "border-brass-600" : "border-ink-100",
      )}
    >
      {/* Hero */}
      <div className="relative p-2">
        <div className="matte-image overflow-hidden">
          <div className="relative aspect-[3/2] w-full overflow-hidden rounded bg-bone">
            {project.hero_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={project.hero_url}
                alt={`${project.name} hero render`}
                className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-xs px-md text-center">
                <span
                  className="material-symbols-outlined text-[28px] text-ink-500"
                  aria-hidden="true"
                >
                  image
                </span>
                <span className="label-caps text-ink-500">
                  Render pending
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Status pill, top-right of the hero */}
        <span
          className={cn(
            "absolute right-4 top-4 rounded-full px-sm py-[2px] text-[10px] font-semibold uppercase tracking-widest",
            pill.bg,
            pill.text,
          )}
        >
          {pill.label}
        </span>
        {/* Multi-select checkbox, top-left (visible on hover or when selected) */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelected();
          }}
          aria-label={isSelected ? "Deselect project" : "Select project"}
          aria-pressed={isSelected}
          className={cn(
            "focus-ring absolute left-4 top-4 flex size-7 items-center justify-center rounded-md border bg-paper transition-opacity",
            isSelected
              ? "border-brass-600 opacity-100"
              : "border-ink-100 opacity-0 group-hover:opacity-100",
          )}
        >
          {isSelected ? (
            <span
              className="material-symbols-outlined text-[16px] text-brass-600"
              aria-hidden="true"
            >
              check
            </span>
          ) : null}
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-lg">
        <p className="label-caps mb-xs text-outline">Residence</p>
        <h3
          className="font-display text-headline-md leading-tight text-on-surface"
          style={{ fontSize: "24px", lineHeight: "30px" }}
        >
          {project.name}
        </h3>
        <p className="mt-xs font-body text-body-sm text-on-surface-variant">
          {project.city ?? "Dubai"} · Villa refit
        </p>

        {/* Stat strip */}
        <div className="mt-md grid h-12 grid-cols-2 items-center border-y border-ink-100">
          <div>
            <p className="label-caps text-ink-500">Budget</p>
            <p className="font-mono text-body-sm tabular-nums text-ink-900">
              {formatAedShort(project.budget_aed)}
            </p>
          </div>
          <div>
            <p className="label-caps text-ink-500">Phase</p>
            <p className="font-body text-body-sm text-ink-900">
              {phaseSubtitle(project.phase)}
            </p>
          </div>
        </div>

        {/* 4-dot phase tracker */}
        <div className="mt-md">
          <PhaseDots phase={project.phase} />
        </div>

        {/* Bottom row */}
        <div className="mt-md flex items-center justify-between">
          <Link
            href={`/project/${project.id}`}
            className="font-body text-body-sm font-semibold text-brass-600 group-hover:underline"
          >
            Open project →
          </Link>
          <RowActionsMenu projectId={project.id} projectName={project.name} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add card
// ---------------------------------------------------------------------------

function AddCard() {
  return (
    <Link
      href="/project/new"
      className="focus-ring group flex h-[420px] flex-col items-center justify-center gap-sm rounded-lg border border-dashed border-ink-100 bg-paper p-lg text-center transition-colors hover:border-brass-600"
    >
      <span
        className="material-symbols-outlined text-[32px] text-brass-600"
        aria-hidden="true"
      >
        add
      </span>
      <p className="font-display text-headline-md text-ink-900">
        Start a new villa
      </p>
      <p className="font-body text-body-sm text-on-surface-variant">
        Upload a floorplan to begin
      </p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function ListView({
  projects,
  selected,
  onToggleSelected,
  page,
  totalPages,
  pageStart,
  pageEnd,
  total,
  onPage,
}: {
  projects: PortfolioProject[];
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  total: number;
  onPage: (n: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink-100 bg-paper">
      <table className="w-full border-collapse">
        <colgroup>
          <col style={{ width: "40px" }} />
          <col style={{ width: "auto" }} />
          <col style={{ width: "180px" }} />
          <col style={{ width: "180px" }} />
          <col style={{ width: "140px" }} />
          <col style={{ width: "140px" }} />
          <col style={{ width: "160px" }} />
          <col style={{ width: "80px" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-ink-100">
            <th className="px-sm py-md" aria-label="Select" />
            <th className="label-caps px-md py-md text-left text-on-surface-variant">
              Villa
            </th>
            <th className="label-caps px-md py-md text-left text-on-surface-variant">
              Location
            </th>
            <th className="label-caps px-md py-md text-left text-on-surface-variant">
              Phase
            </th>
            <th className="label-caps px-md py-md text-right text-on-surface-variant">
              Budget
            </th>
            <th className="label-caps px-md py-md text-right text-on-surface-variant">
              BoQ total
            </th>
            <th className="label-caps px-md py-md text-left text-on-surface-variant">
              Last updated
            </th>
            <th className="px-sm py-md" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {projects.map((p, i) => (
            <ListRow
              key={p.id}
              project={p}
              striped={i % 2 === 1}
              isSelected={selected.has(p.id)}
              onToggleSelected={() => onToggleSelected(p.id)}
            />
          ))}
        </tbody>
      </table>
      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between border-t border-ink-100 px-lg py-md">
          <p className="font-body text-body-sm text-on-surface-variant">
            Showing{" "}
            <span className="font-mono tabular-nums">{pageStart + 1}</span>–
            <span className="font-mono tabular-nums">{pageEnd}</span> of{" "}
            <span className="font-mono tabular-nums">{total}</span>
          </p>
          <div className="flex items-center gap-sm">
            <PageButton
              icon="chevron_left"
              disabled={page <= 1}
              onClick={() => onPage(Math.max(1, page - 1))}
              label="Previous page"
            />
            <p className="font-mono text-body-sm tabular-nums text-ink-900">
              {page} / {totalPages}
            </p>
            <PageButton
              icon="chevron_right"
              disabled={page >= totalPages}
              onClick={() => onPage(Math.min(totalPages, page + 1))}
              label="Next page"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PageButton({
  icon,
  onClick,
  disabled,
  label,
}: {
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="focus-ring flex h-8 w-8 items-center justify-center rounded-md border border-ink-100 bg-paper text-on-surface-variant transition-colors hover:border-brass-600 hover:text-ink-900 disabled:opacity-40 disabled:hover:border-ink-100"
    >
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// List row
// ---------------------------------------------------------------------------

function ListRow({
  project,
  striped,
  isSelected,
  onToggleSelected,
}: {
  project: PortfolioProject;
  striped: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
}) {
  const pill = PHASE_PILL[project.phase];
  const delta =
    project.boq_total_aed != null && project.budget_aed != null
      ? project.boq_total_aed - project.budget_aed
      : null;

  return (
    <tr
      className={cn(
        "h-[72px] border-b border-ink-100",
        striped ? "bg-canvas" : "bg-paper",
        isSelected && "bg-primary-fixed/40",
      )}
    >
      {/* Checkbox */}
      <td className="px-sm">
        <button
          type="button"
          onClick={onToggleSelected}
          aria-label={isSelected ? "Deselect" : "Select"}
          aria-pressed={isSelected}
          className={cn(
            "focus-ring flex size-5 items-center justify-center rounded border bg-paper",
            isSelected ? "border-brass-600" : "border-ink-100",
          )}
        >
          {isSelected && (
            <span
              className="material-symbols-outlined text-[14px] text-brass-600"
              aria-hidden="true"
            >
              check
            </span>
          )}
        </button>
      </td>
      {/* Villa: thumb + name + pill */}
      <td className="px-md">
        <div className="flex items-center gap-md">
          <div className="matte-image shrink-0 !p-1">
            <div className="h-8 w-12 overflow-hidden rounded bg-bone">
              {project.hero_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={project.hero_url}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <span
                    className="material-symbols-outlined text-[14px] text-ink-500"
                    aria-hidden="true"
                  >
                    image
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <p className="truncate font-body text-body-md font-semibold text-ink-900">
              {project.name}
            </p>
            <span
              className={cn(
                "mt-xs inline-block rounded-full px-sm py-[1px] text-[9px] font-semibold uppercase tracking-widest",
                pill.bg,
                pill.text,
              )}
            >
              {pill.label}
            </span>
          </div>
        </div>
      </td>
      {/* Location */}
      <td className="px-md">
        <p className="font-body text-body-md text-ink-900">
          {project.city ?? "Dubai"}
        </p>
      </td>
      {/* Phase */}
      <td className="px-md">
        <PhaseDots phase={project.phase} />
      </td>
      {/* Budget */}
      <td className="px-md text-right">
        <p className="font-mono text-body-sm tabular-nums text-ink-900">
          {formatAed(project.budget_aed)}
        </p>
      </td>
      {/* BoQ total + delta */}
      <td className="px-md text-right">
        <p className="font-mono text-body-sm tabular-nums text-ink-900">
          {formatAed(project.boq_total_aed)}
        </p>
        {delta != null && (
          <p
            className={cn(
              "mt-xs font-body text-[11px]",
              delta <= 0 ? "text-tertiary" : "text-error",
            )}
          >
            {delta <= 0 ? "−" : "+"}
            {formatAed(Math.abs(delta))}
          </p>
        )}
      </td>
      {/* Last updated */}
      <td className="px-md">
        <p className="font-body text-body-sm text-ink-900">
          {relativeTime(project.last_updated_at)}
        </p>
      </td>
      {/* Actions */}
      <td className="px-sm">
        <div className="flex items-center justify-end gap-xs">
          <Link
            href={`/project/${project.id}`}
            aria-label="Open project"
            className="focus-ring flex size-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low hover:text-ink-900"
          >
            <span
              className="material-symbols-outlined text-[18px]"
              aria-hidden="true"
            >
              chevron_right
            </span>
          </Link>
          <RowActionsMenu projectId={project.id} projectName={project.name} />
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Row-actions menu (popover from more_horiz)
// ---------------------------------------------------------------------------

const MENU_WIDTH = 224; // w-56
const MENU_EST_HEIGHT = 268; // ~6 items + divider; used only for flip decision

function RowActionsMenu({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Position the menu against the trigger in viewport (fixed) coordinates. The
  // menu is portalled to <body> so it escapes the card's `overflow-hidden` clip
  // and the hover-transform stacking context that otherwise hide it.
  const place = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const left = Math.max(8, r.right - MENU_WIDTH);
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < MENU_EST_HEIGHT && r.top > MENU_EST_HEIGHT;
    const top = flipUp ? r.top - MENU_EST_HEIGHT - 4 : r.bottom + 4;
    setCoords({ left, top });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    // A menu positioned once against the viewport goes stale on scroll/resize —
    // simplest correct behaviour is to close it.
    function onReflow() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring flex size-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low hover:text-ink-900"
      >
        <span
          className="material-symbols-outlined text-[18px]"
          aria-hidden="true"
        >
          more_horiz
        </span>
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              width: MENU_WIDTH,
            }}
            className="z-50 overflow-hidden rounded-lg border border-ink-100 bg-paper shadow-level-1"
          >
            <MenuItem
              href={`/project/${projectId}`}
              icon="open_in_new"
              label="Open project"
            />
            <MenuItem icon="content_copy" label="Duplicate as new" />
            <MenuItem icon="share" label="Share with designer" />
            <MenuItem
              href={`/project/${projectId}/boq`}
              icon="picture_as_pdf"
              label="Export BoQ as PDF"
            />
            <MenuItem icon="archive" label="Archive" tone="terracotta" />
            <div className="my-xs h-px bg-ink-100" role="separator" />
            <MenuItem
              icon="delete"
              label="Delete project"
              tone="error"
              onClick={() => {
                setOpen(false);
                setConfirmOpen(true);
              }}
            />
          </div>,
          document.body,
        )}

      <DeleteProjectDialog
        open={confirmOpen}
        projectId={projectId}
        projectName={projectName}
        onClose={() => setConfirmOpen(false)}
        onDeleted={() => {
          setConfirmOpen(false);
          // The list is server-rendered; re-fetch so the row disappears.
          router.refresh();
        }}
      />
    </>
  );
}

function MenuItem({
  href,
  icon,
  label,
  tone = "neutral",
  onClick,
}: {
  href?: string;
  icon: string;
  label: string;
  tone?: "neutral" | "terracotta" | "error";
  onClick?: () => void;
}) {
  const cls = cn(
    "flex w-full items-center gap-md px-md py-sm text-left font-body text-body-sm hover:bg-surface-container-low",
    tone === "terracotta" && "text-tertiary",
    tone === "error" && "text-error",
    tone === "neutral" && "text-ink-900",
  );
  const inner = (
    <>
      <span
        className={cn(
          "material-symbols-outlined text-[18px]",
          tone === "error" ? "text-error" : "text-on-surface-variant",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </>
  );
  if (href) {
    return (
      <Link href={href} role="menuitem" className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

function DeleteProjectDialog({
  open,
  projectId,
  projectName,
  onClose,
  onDeleted,
}: {
  open: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error ?? `Delete failed (${res.status}).`);
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !deleting) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="w-[92vw] max-w-[440px] border border-ink-100 bg-paper p-6 duration-200 sm:max-w-[440px]">
        <div className="flex flex-col gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-error-container text-error">
            <span
              className="material-symbols-outlined text-2xl"
              aria-hidden="true"
            >
              delete
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <DialogTitle className="font-display text-headline-md text-ink-900">
              Delete this project?
            </DialogTitle>
            <DialogDescription className="font-body text-body-md text-on-surface-variant">
              <span className="font-semibold text-ink-900">{projectName}</span>{" "}
              and everything in it — the parsed plan, renders, BoQ, and vendor
              selections — will be permanently removed. This can&apos;t be
              undone.
            </DialogDescription>
          </div>
          {error && (
            <p className="font-body-sm text-body-sm text-error">{error}</p>
          )}
          <div className="mt-2 flex justify-end gap-sm">
            <button
              type="button"
              onClick={onClose}
              disabled={deleting}
              className="focus-ring flex h-11 items-center rounded-lg border border-ink-100 px-lg font-body text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="focus-ring flex h-11 items-center gap-sm rounded-lg bg-error px-lg font-body text-body-sm font-semibold text-on-error transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete project"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Phase dots
// ---------------------------------------------------------------------------

const DOT_PHASES: Phase[] = ["Design", "BoQ", "Bidding", "In Construction"];

// Maps a project phase onto the 4-dot tracker. Active/Intake → before design;
// Handover/Completed → past construction.
function dotIndexFor(phase: Phase): number {
  if (phase === "Active") return -1; // nothing filled
  if (phase === "On hold") return -1;
  if (phase === "Design") return 0;
  if (phase === "BoQ") return 1;
  if (phase === "Bidding") return 2;
  if (phase === "In Construction") return 3;
  if (phase === "Handover" || phase === "Completed") return 4; // all filled
  return -1;
}

function PhaseDots({ phase }: { phase: Phase }) {
  const idx = dotIndexFor(phase);
  return (
    <div
      className="flex items-center gap-xs"
      role="img"
      aria-label={`Phase: ${phase}`}
    >
      <div className="flex-1">
        <div className="relative h-px w-full bg-bone">
          <div className="flex h-px items-center justify-between">
            {DOT_PHASES.map((p, i) => {
              const filled = i <= idx;
              const isActive = i === idx;
              return (
                <span
                  key={p}
                  className={cn(
                    "block size-2 -translate-y-[3.5px] rounded-full transition-colors",
                    filled ? "bg-brass-600" : "bg-bone",
                    isActive && "ring-2 ring-brass-600 ring-offset-1",
                  )}
                  aria-hidden="true"
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk button
// ---------------------------------------------------------------------------

function BulkButton({ icon, label }: { icon: string; label: string }) {
  return (
    <button
      type="button"
      className="focus-ring flex items-center gap-xs font-body text-body-sm font-semibold text-on-surface-variant hover:text-ink-900"
    >
      <span
        className="material-symbols-outlined text-[18px]"
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-3xl">
      <div className="w-full max-w-[480px] rounded-lg border border-ink-100 bg-paper p-xl text-center">
        <h2
          className="font-display italic text-ink-900"
          style={{ fontSize: "32px", lineHeight: "40px" }}
        >
          No villas yet.
        </h2>
        <p className="mx-auto mt-md max-w-[360px] font-body text-body-md text-on-surface-variant">
          Drop a floorplan to start your first project. We&apos;ll take it from
          there.
        </p>
        <Link
          href="/project/new"
          className="focus-ring mt-lg flex h-11 w-full items-center justify-center gap-sm rounded-lg bg-brass-600 px-md font-body text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
        >
          <span
            className="material-symbols-outlined text-[18px]"
            aria-hidden="true"
          >
            upload
          </span>
          Upload a floorplan
        </Link>
        <p className="mt-md">
          <a
            href="#"
            className="font-body text-body-sm text-on-surface-variant hover:text-brass-600"
          >
            Watch the 3-minute demo first →
          </a>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatAed(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `AED ${Math.round(n).toLocaleString("en-US")}`;
}

function formatAedShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `AED ${Math.round(n / 1_000)}k`;
  return `AED ${Math.round(n)}`;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function phaseSubtitle(phase: Phase): string {
  const idx = dotIndexFor(phase);
  if (idx < 0) return phase;
  const total = DOT_PHASES.length;
  const stepNum = Math.min(idx + 1, total);
  return `0${stepNum} of 0${total}`;
}

// ---------------------------------------------------------------------------
// Pill style lookup
// ---------------------------------------------------------------------------

const PHASE_PILL: Record<
  Phase,
  { label: string; bg: string; text: string }
> = {
  Active: {
    label: "Active",
    bg: "bg-primary-fixed",
    text: "text-on-primary-fixed",
  },
  Design: {
    label: "Design",
    bg: "bg-secondary-container",
    text: "text-on-secondary-container",
  },
  BoQ: {
    label: "BoQ",
    bg: "bg-primary-fixed",
    text: "text-on-primary-fixed",
  },
  Bidding: {
    label: "Bidding",
    bg: "bg-tertiary-container",
    text: "text-on-tertiary-container",
  },
  "In Construction": {
    label: "In construction",
    bg: "bg-tertiary-container",
    text: "text-on-tertiary-container",
  },
  Handover: {
    label: "Handover",
    bg: "bg-outline-variant",
    text: "text-on-surface-variant",
  },
  "On hold": {
    label: "On hold",
    bg: "bg-error-container",
    text: "text-on-error-container",
  },
  Completed: {
    label: "Completed",
    bg: "bg-outline-variant",
    text: "text-on-surface-variant",
  },
};
