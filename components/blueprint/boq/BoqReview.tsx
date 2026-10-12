"use client";

// =============================================================================
// components/blueprint/boq/BoqReview.tsx — the BoQ & Review screen (K3,
// R7 §3.2). Client root: owns the screen state (collapsed sections, the
// selected line, the provenance popover, the current section) over the data
// the server built (lib/boq/review-model.ts). It never prices anything: every
// figure it shows is the stored BoQ's.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ReviewLine, ReviewModel } from "@/lib/boq/review-types";
import type { FigureRole } from "@/lib/provenance/tier-vocab";

import { Button } from "../Button";
import { TopBarActions } from "../shell/TopBar";
import { BoqGrid, rowDomId, sectionDomId } from "./BoqGrid";
import { correctionsFor, type Correction } from "./CorrectionsTab";
import { Inspector, type InspectorTab } from "./Inspector";
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
  /** Rendered in the work area until the regenerate control is wired (K3 commit 3). */
  regenerate?: ReactNode;
  /** P5: the grade engine, when the BoQ has take-off provenance and WHATIF is on. */
  engine: WhatIfEngine | null;
}

const HOVER_DELAY = 250;
const CLOSE_GRACE = 120;

export function BoqReview({ model, rooms, furniture, permits, packExport, highlightRef, view, highlightRoom, regenerate, engine }: BoqReviewProps) {
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<string | null>(null);
  const selected = useMemo(() => (selectedKey ? (model.sections.flatMap((s) => s.lines).find((l) => l.key === selectedKey) ?? null) : null), [model.sections, selectedKey]);
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

  // --- corrections: this project's, once (a correction is recorded, never applied) ---
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/boq-corrections?project_id=${model.projectId}`)
      .then((r) => (r.ok ? r.json() : { corrections: [] }))
      .then((b: { corrections?: Correction[] }) => !cancelled && setCorrections(b.corrections ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [model.projectId]);

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
  };
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
        <span className="t-label-md whitespace-nowrap text-bp-ink-tertiary">
          rev {model.rev} · {model.revDate}
          {model.notices.draft ? " · draft" : ""}
        </span>
        <Button kind="quiet" href={`/project/${model.projectId}/boq/revisions`}>
          Revisions &amp; diff
        </Button>
        {packExport ? (
          <Button kind="secondary" href={`/project/${model.projectId}/drawings?export=1`}>
            Export BoQ PDF
          </Button>
        ) : null}
      </TopBarActions>

      <div ref={pinnedRef} className="bp-boq-pinned">
        <PinnedTotal model={model} />
      </div>
      <Notices model={model} permits={permits} />
      {regenerate ? <div className="px-6 pt-4 md:px-8">{regenerate}</div> : null}

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
          <BoqGrid
            sections={model.sections}
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
        {selected ? (
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
              engine={engine}
              furniture={furniture?.total ?? null}
              onClose={closeInspector}
              headingRef={headingRef}
            />
          </aside>
        ) : null}
      </div>

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
