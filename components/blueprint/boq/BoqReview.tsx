"use client";

// =============================================================================
// components/blueprint/boq/BoqReview.tsx — the BoQ & Review screen (K3,
// R7 §3.2). Client root: owns the screen state (collapsed sections, the
// selected line, the provenance popover, the current section) over the data
// the server built (lib/boq/review-model.ts). It never prices anything: every
// figure it shows is the stored BoQ's.
// =============================================================================

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatAED, formatDelta } from "@/lib/format/aed";

import { boqIssues, nextIssueKey, type IssueRow } from "@/lib/boq/issues";
import type { ReviewLine, ReviewModel } from "@/lib/boq/review-types";
import type { StepStatus } from "@/lib/journey-state";
import type { FigureRole } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { RegenerateControl } from "../RegenerateControl";
import { IssuesNavigator } from "../shell/IssuesNavigator";
import { TopBarActions } from "../shell/TopBar";
import { BoqGrid, rowDomId, sectionDomId } from "./BoqGrid";
import { correctionsFor, type Applied, type Correction } from "./CorrectionsTab";
import { Inspector, type InspectorTab } from "./Inspector";
import { InspectorSheet, useSheetLayout } from "./InspectorSheet";
import { useRegenerate, type RegenerateStart } from "./Regenerate";
import type { WhatIfEngine } from "./WhatIfTab";
import { ByRoom, Furniture, Programme, type FurnitureView, type RoomRollup } from "./Extras";
import { Notices } from "./Notices";
import { PinnedTotal } from "./PinnedTotal";
import { ProvenancePopover, type PopoverTarget } from "./ProvenancePopover";
import { SectionChips, SectionIndex } from "./SectionIndex";
import { SUMMARY_ID, SummaryChain } from "./SummaryChain";

export interface BoqReviewProps {
  model: ReviewModel;
  rooms: RoomRollup[];
  furniture: FurnitureView | null;
  permits: { title: string; consequence: string }[] | null;
  /** T5: the BoQ PDF is released only through Export pack (flag decided on the server). */
  packExport: boolean;
  /** A deep link's REF, already resolved against this BoQ (D5). */
  highlightRef: string | null;
  view: "sections" | "byroom";
  highlightRoom: string | null;
  /** The regenerate control's starting state — the server's readiness + changesSinceRevision answers. */
  regen: RegenerateStart;
  /** P5: the grade engine, when the BoQ has take-off provenance and WHATIF is on. */
  engine: WhatIfEngine | null;
  /** K11 #3: the rail's status for this step (owner 04 Cost / firm 05 BoQ & Review) — the navigator's step row. */
  stepStatus?: StepStatus | null;
}

const HOVER_DELAY = 250;
const CLOSE_GRACE = 120;

export function BoqReview({ model, rooms, furniture, permits, packExport, highlightRef, view, highlightRoom, regen, engine, stepStatus = null }: BoqReviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const lineByRef = useMemo(() => new Map(model.sections.flatMap((s) => s.lines.map((l) => [l.ref, l] as const))), [model.sections]);
  const initialSelected = highlightRef ? (lineByRef.get(highlightRef)?.key ?? null) : null;

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelected);
  const [current, setCurrent] = useState<string | null>(model.sections[0]?.name ?? null);
  const [pop, setPop] = useState<PopoverTarget | null>(null);
  const [tab, setTab] = useState<InspectorTab>("line");
  const [capturing, setCapturing] = useState(false);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  // K11 #4: the revision an applied price / correction just created (the page refreshes to it).
  const [applied, setApplied] = useState<Applied | null>(null);
  // K11 #3: the Issues navigator — from the model and the rail's own status for this step.
  const issues = useMemo(() => boqIssues(model, stepStatus), [model, stepStatus]);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const issueKeys = useMemo(() => new Set(issues.lineKeys), [issues.lineKeys]);
  const gridSections = useMemo(
    () => (onlyIssues && issueKeys.size > 0 ? model.sections.map((s) => ({ ...s, lines: s.lines.filter((l) => issueKeys.has(l.key)) })).filter((s) => s.lines.length > 0) : model.sections),
    [onlyIssues, issueKeys, model.sections],
  );
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<string | null>(null);
  const selected = useMemo(() => (selectedKey ? (model.sections.flatMap((s) => s.lines).find((l) => l.key === selectedKey) ?? null) : null), [model.sections, selectedKey]);
  const regenerate = useRegenerate(model.projectId, regen);
  const layout = useSheetLayout();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- the sticky offsets follow the pinned bar's real height ---------------------
  useEffect(() => {
    const el = pinnedRef.current;
    const root = rootRef.current;
    if (!el || !root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => root.style.setProperty("--bp-boq-pinned-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- current section: the last header scrolled up to the sticky line -------------
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) return;
        const line = parseFloat(getComputedStyle(root).getPropertyValue("--bp-boq-pinned-h")) + 64 + 60;
        let name = model.sections[0]?.name ?? null;
        for (const s of model.sections) {
          const g = document.querySelector(`[data-section="${CSS.escape(s.name)}"]`);
          if (g && g.getBoundingClientRect().top <= line) name = s.name;
        }
        setCurrent(name);
      });
      setPop(null);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [model.sections]);

  // --- deep link: ?highlight=REF scrolls to its row ---------------------------------
  useEffect(() => {
    if (!highlightRef || view !== "sections") return;
    document.getElementById(rowDomId(highlightRef))?.scrollIntoView({ block: "center" });
  }, [highlightRef, view]);
  useEffect(() => {
    if (view === "byroom") document.getElementById(highlightRoom ? `boq-room-${highlightRoom}` : "boq-by-room")?.scrollIntoView({ block: "start" });
  }, [view, highlightRoom]);

  // --- corrections: this project's — again whenever a new revision lands (K11 #4) ---
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/boq-corrections?project_id=${model.projectId}`)
      .then((r) => (r.ok ? r.json() : { corrections: [] }))
      .then((b: { corrections?: Correction[] }) => !cancelled && setCorrections(b.corrections ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [model.projectId, model.boqId]);

  /** A price added / correction applied: the next revision exists — show it at once (total, marks, issues). */
  const onApplied = useCallback(
    (a: Applied) => {
      setApplied(a);
      router.refresh();
    },
    [router],
  );

  // --- popover ---------------------------------------------------------------------
  const target = useCallback(
    (line: ReviewLine, role: FigureRole, el: HTMLElement): PopoverTarget => {
      const r = el.getBoundingClientRect();
      const sel = selectedKey ? document.querySelector(`[data-line-key="${CSS.escape(selectedKey)}"]`)?.getBoundingClientRect() : null;
      return { line, role, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, avoid: sel && selectedKey !== line.key ? { top: sel.top, bottom: sel.bottom } : null };
    },
    [selectedKey],
  );
  const clearTimers = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const handlers = {
    onFigureEnter: (line: ReviewLine, role: FigureRole, el: HTMLElement) => {
      clearTimers();
      hoverTimer.current = setTimeout(() => setPop(target(line, role, el)), HOVER_DELAY);
    },
    onFigureLeave: () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      closeTimer.current = setTimeout(() => setPop(null), CLOSE_GRACE);
    },
    onFigureFocus: (line: ReviewLine, role: FigureRole, el: HTMLElement) => {
      clearTimers();
      setPop(target(line, role, el));
    },
    onFigureBlur: () => {
      clearTimers();
      setPop(null);
    },
    onEscape: () => {
      if (!pop) return false;
      setPop(null);
      return true;
    },
    popoverFor: pop ? `${pop.line.ref}:${pop.role}` : null,
  };

  // --- sections --------------------------------------------------------------------
  const toggleSection = (name: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allCollapsed = collapsed.size === model.sections.length && model.sections.length > 0;
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(model.sections.map((s) => s.name)));

  function stickyOffset() {
    const root = rootRef.current;
    const pinned = root ? parseFloat(getComputedStyle(root).getPropertyValue("--bp-boq-pinned-h")) || 120 : 120;
    const topbar = document.querySelector(".bp-topbar")?.getBoundingClientRect().height ?? 64;
    const chips = document.querySelector<HTMLElement>(".bp-boq-chips");
    return topbar + pinned + (chips && chips.offsetParent ? chips.offsetHeight : 0) + 8;
  }
  function jump(name: string) {
    const s = model.sections.find((x) => x.name === name);
    if (!s) return;
    if (collapsed.has(name)) toggleSection(name);
    const group = document.querySelector<HTMLElement>(`[data-section="${CSS.escape(name)}"]`);
    if (group) window.scrollTo({ top: group.getBoundingClientRect().top + window.scrollY - stickyOffset(), behavior: "instant" as ScrollBehavior });
    document.getElementById(sectionDomId(s.code))?.focus({ preventScroll: true });
    setCurrent(name);
  }
  function toSummary() {
    const el = document.getElementById(SUMMARY_ID);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyOffset(), behavior: "instant" as ScrollBehavior });
    el.focus({ preventScroll: true });
  }

  const openLine = (key: string) => {
    setPop(null);
    if (key !== selectedKey) {
      setTab("line");
      setCapturing(false);
    }
    opener.current = key;
    setSelectedKey(key);
    if (layout.sheet && !layout.phone) {
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(key)}"]`);
        if (row) window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - stickyOffset() - 8, behavior: "instant" as ScrollBehavior });
      });
    }
  };
  /** K11 #3: scroll a line under the sticky header, opening its section if it is collapsed. */
  const revealLine = (key: string) => {
    const section = model.sections.find((s) => s.lines.some((l) => l.key === key));
    if (section && collapsed.has(section.name)) toggleSection(section.name);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(key)}"]`);
        // Below the sticky section header too (it pins over the first rows of its section).
        const header = row?.closest("[data-section]")?.querySelector<HTMLElement>("[role='row']")?.offsetHeight ?? 48;
        if (!row) return;
        window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - stickyOffset() - header - 8, behavior: "instant" as ScrollBehavior });
        // Then correct by what is really pinned above it (the column header row sticks too).
        const pinnedHeader = row.closest("[data-section]")?.querySelector<HTMLElement>("[role='row']");
        const overlap = pinnedHeader ? pinnedHeader.getBoundingClientRect().bottom + 4 - row.getBoundingClientRect().top : 0;
        if (overlap > 0) window.scrollBy({ top: -overlap, behavior: "instant" as ScrollBehavior });
      }),
    );
  };
  /** A navigator row: scroll to the line, select it, open the inspector on the right action. */
  const goToIssue = (row: IssueRow) => {
    if (!row.lineKey) return;
    if (onlyIssues && !issueKeys.has(row.lineKey)) setOnlyIssues(false);
    openLine(row.lineKey);
    setTab("line");
    setCapturing(row.open === "price");
    revealLine(row.lineKey);
  };
  /** J / Shift+J — the next / previous issue line. */
  const nextIssue = (back = false) => {
    const key = nextIssueKey(issues.lineKeys, selectedKey, back);
    if (!key) return;
    openLine(key);
    setTab("line");
    revealLine(key);
  };
  const nextIssueRef = useRef(nextIssue);
  useEffect(() => {
    nextIssueRef.current = nextIssue;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "J") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      nextIssueRef.current(e.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Close returns focus to the row it was opened from (§4.2 #4). */
  const closeInspector = () => {
    const key = opener.current ?? selectedKey;
    setSelectedKey(null);
    setCapturing(false);
    requestAnimationFrame(() => {
      const row = key ? document.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(key)}"] [role="gridcell"]:not([hidden])`) : null;
      row?.focus();
    });
  };

  return (
    <div ref={rootRef} className="bp-boq" data-boq-review="" data-rev={model.rev}>
      <TopBarActions>
        <span className="bp-boq-wide-only t-label-md whitespace-nowrap text-bp-ink-tertiary">
          rev {model.rev} · {model.revDate}
          {model.notices.draft ? " · draft" : ""}
        </span>
        <IssuesNavigator issues={issues} onRow={goToIssue} onlyThese={{ on: onlyIssues, set: setOnlyIssues }} onNext={() => nextIssue(false)} context={`rev ${model.rev}`} />
        <Button kind="quiet" href={`/project/${model.projectId}/boq/revisions`}>
          Revisions &amp; diff
        </Button>
        {packExport ? (
          <span className="bp-boq-desk-only">
            <Button kind="secondary" href={`/project/${model.projectId}/drawings?export=1`}>
              Export BoQ PDF
            </Button>
          </span>
        ) : null}
        <RegenerateControl value={regenerate.value} onRegenerate={regenerate.run} />
      </TopBarActions>

      <div ref={pinnedRef} className="bp-boq-pinned">
        <PinnedTotal model={model} />
      </div>
      {applied ? (
        <p role="status" className="t-body-sm mx-6 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-bp-brass bg-bp-surface-raised px-4 py-3 text-bp-ink-primary md:mx-8" data-applied-rev={applied.rev}>
          <span>
            Rev {applied.rev} · {applied.origin === "add_price" ? "price added" : "correction applied"} on {applied.ref} — total{" "}
            <span className="t-num-sm">{formatAED(applied.total)}</span> <span className="t-num-sm text-bp-ink-secondary">({formatDelta(Math.round((applied.total - applied.previousTotal) * 100) / 100)})</span>
          </span>
          <Link href={`/project/${model.projectId}/boq/revisions?from=${applied.previousBoqId}&to=${applied.boqId}`} className="t-nav-item-active text-bp-ink-primary underline underline-offset-2">
            See the change · undo in Revisions
          </Link>
          <button type="button" onClick={() => setApplied(null)} className="ml-auto text-bp-ink-secondary hover:text-bp-ink-primary" aria-label="Dismiss">
            <Icon name="close" size={18} />
          </button>
        </p>
      ) : null}
      <Notices model={model} permits={permits} />
      {regenerate.running ? (
        <p role="status" className="t-body-sm mx-6 mt-4 flex items-center gap-2 bg-bp-surface-sunken px-4 py-3 text-bp-ink-secondary md:mx-8" data-regenerating="">
          Showing rev {model.rev} while rev {model.rev + 1} is generated — every figure below is rev {model.rev}&rsquo;s until it lands.
        </p>
      ) : null}
      {/* Phone: the top bar holds the step switcher, so Regenerate sits here. */}
      <div className="bp-phone-only px-6 pt-4">
        <RegenerateControl value={regenerate.value} onRegenerate={regenerate.run} />
      </div>

      <SectionChips sections={model.sections} current={current} onJump={jump} persona={model.persona} />

      <div className="bp-boq-work px-6 pb-16 pt-6 md:px-8" data-inspector={selected ? "open" : "closed"}>
        <SectionIndex
          sections={model.sections}
          current={current}
          onJump={jump}
          onSummary={toSummary}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
          persona={model.persona}
          extra={
            rooms.length > 0 ? (
              <a href="#boq-by-room" className="t-nav-item-active block py-1.5 text-bp-ink-primary hover:text-bp-ink-secondary">
                Cost by room
              </a>
            ) : null
          }
        />
        <div className="min-w-0">
          {onlyIssues ? (
            <p role="status" className="t-body-sm mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 bg-bp-surface-sunken px-4 py-2 text-bp-ink-secondary" data-only-issues="">
              Showing only the {issues.lineKeys.length} line{issues.lineKeys.length === 1 ? "" : "s"} to fix
              <button type="button" onClick={() => setOnlyIssues(false)} className="t-nav-item-active text-bp-ink-primary underline underline-offset-2">
                Show every line
              </button>
            </p>
          ) : null}
          <BoqGrid
            sections={gridSections}
            collapsed={collapsed}
            onToggleSection={toggleSection}
            selectedKey={selectedKey}
            onOpenLine={openLine}
            persona={model.persona}
            {...handlers}
          />
          <SummaryChain model={model} />
          {model.programme ? <Programme programme={model.programme} /> : null}
          {rooms.length > 0 ? <ByRoom rooms={rooms} open={view === "byroom"} highlightRoom={highlightRoom} /> : null}
          {furniture ? <Furniture furniture={furniture} /> : null}
        </div>
        {selected && !layout.sheet ? (
          <aside
            aria-labelledby="bp-boq-inspector-heading"
            className="bp-boq-inspector border border-bp-line-strong bg-bp-surface-base"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeInspector();
              }
            }}
            data-inspector-for={selected.ref}
          >
            <Inspector
              line={selected}
              model={model}
              tab={tab}
              setTab={setTab}
              corrections={correctionsFor(corrections, selected)}
              capturing={capturing}
              setCapturing={setCapturing}
              onCorrectionSaved={(c) => setCorrections((cur) => [...cur, c])}
              onApplied={onApplied}
              onNextIssue={issues.lineKeys.length > 0 ? () => nextIssue(false) : undefined}
              engine={engine}
              furniture={furniture?.total ?? null}
              onClose={closeInspector}
              headingRef={headingRef}
            />
          </aside>
        ) : null}
      </div>

      {layout.sheet ? (
        <InspectorSheet open={!!selected} phone={layout.phone} onClose={closeInspector}>
          {selected ? (
            <Inspector
              line={selected}
              model={model}
              tab={tab}
              setTab={setTab}
              corrections={correctionsFor(corrections, selected)}
              capturing={capturing}
              setCapturing={setCapturing}
              onCorrectionSaved={(c) => setCorrections((cur) => [...cur, c])}
              onApplied={onApplied}
              onNextIssue={issues.lineKeys.length > 0 ? () => nextIssue(false) : undefined}
              engine={engine}
              furniture={furniture?.total ?? null}
              onClose={closeInspector}
              headingRef={headingRef}
            />
          ) : null}
        </InspectorSheet>
      ) : null}

      {pop ? (
        <ProvenancePopover
          target={pop}
          persona={model.persona}
          onPointerEnter={clearTimers}
          onPointerLeave={() => {
            closeTimer.current = setTimeout(() => setPop(null), CLOSE_GRACE);
          }}
        />
      ) : null}
    </div>
  );
}
