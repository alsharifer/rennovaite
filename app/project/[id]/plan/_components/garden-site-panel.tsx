"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/blueprint/Button";
import { Icon } from "@/components/blueprint/Icon";
import { cn } from "@/lib/utils";

import { FIELD, NUM_FIELD_BASE } from "./editor-chrome";

// G5: the garden's standing questions, in one place under the plan.
//
//  - Is this a DRAFT? Which boundary-critical dimensions are still derived, and
//    from what. The documents carry the same verdict; this is where it is fixed.
//  - What already stands on site, and what the design does with each item —
//    keep, remove or replace. Keep excludes an item from demolition and new work.
//  - The attributes a zone's outline cannot carry: its level, a structure's height.
//  - Whether the pack can export (no counter left untyped, nothing undecided).
//  - A friction log, because the list of what got in the designer's way is pilot
//    data and is only accurate when written down at the moment.
//
// Blueprint since K8 (it sits under the plan canvas on the 02 Scope page).

export type SiteItemTable = "zone" | "element" | "fixture" | "context" | "opening";

export interface SiteItem {
  id: string;
  table: SiteItemTable;
  name: string;
  kindLabel: string;
  disposition: "keep" | "remove" | "replace" | null;
  dims_derived: boolean;
  note: string | null;
  /** plan_fixtures needs these to re-post a fixture. */
  fixture?: { type: string; position: [number, number]; room_id: string | null };
}

export interface ZoneAttr {
  id: string;
  name: string;
  type: string | null;
  level_mm: number | null;
  height_mm: number | null;
  site_reference: boolean;
}

const DISPOSITIONS = [
  { value: "keep" as const, label: "Keep", hint: "Retained as is — excluded from demolition and new work" },
  { value: "remove" as const, label: "Remove", hint: "Taken out — demolition only" },
  { value: "replace" as const, label: "Replace", hint: "Taken out and rebuilt as new work" },
];

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json;
}

export function GardenSitePanel({
  projectId,
  planId,
  draft,
  items,
  zones,
  untypedCounters,
}: {
  projectId: string;
  planId: string;
  draft: { draft: boolean; derived: string[]; note: string | null };
  items: SiteItem[];
  zones: ZoneAttr[];
  untypedCounters: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friction, setFriction] = useState("");
  const [frictionArea, setFrictionArea] = useState("plan");
  const [frictionSaved, setFrictionSaved] = useState(false);
  const [showDerived, setShowDerived] = useState(false);

  const undecided = items.filter((i) => i.disposition === null);

  const setDisposition = async (item: SiteItem, disposition: SiteItem["disposition"]) => {
    setBusy(item.id);
    setError(null);
    try {
      if (item.table === "zone") await send("/api/plan-zones", "PATCH", { id: item.id, disposition });
      else if (item.table === "element") await send("/api/plan-elements", "PATCH", { id: item.id, disposition });
      else if (item.table === "context") await send("/api/plan-context", "PATCH", { id: item.id, disposition });
      else if (item.table === "opening") await send("/api/plan-openings", "PATCH", { id: item.id, disposition });
      else if (item.fixture) await send("/api/plan-fixtures", "POST", { id: item.id, project_id: projectId, ...item.fixture, disposition });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const setZone = async (id: string, field: "level_mm" | "height_mm", raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) return;
    setBusy(id + field);
    setError(null);
    try {
      await send("/api/plan-zones", "PATCH", { id, [field]: value });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const logFriction = async () => {
    if (friction.trim().length < 3) return;
    setBusy("friction");
    try {
      await send("/api/pilot-events", "POST", { project_id: projectId, note: friction.trim(), area: frictionArea });
      setFriction("");
      setFrictionSaved(true);
      setTimeout(() => setFrictionSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const groups: { table: SiteItemTable; label: string }[] = [
    { table: "zone", label: "Structures & surfaces" },
    { table: "element", label: "Runs" },
    { table: "fixture", label: "Trees & points" },
    { table: "context", label: "Boundary" },
    { table: "opening", label: "Gates" },
  ];
  const ready = untypedCounters.length === 0 && undecided.length === 0;


  // Blueprint (K8): no status hues — a draft is a flagged notice row, an open
  // readiness item is the inverse block, the chosen disposition is ink + a brass
  // underline, and "approx." / "required" are said in words.
  const frictionOff =
    busy === "friction"
      ? { reason: "Logging…", reasonId: "friction-reason" }
      : friction.trim().length < 3
        ? { reason: "Write at least three characters.", reasonId: "friction-reason" }
        : false;

  return (
    <section className="space-y-6" aria-label="Garden site" data-plan-id={planId}>
      {draft.draft && (
        <div className="border-y border-bp-line-hairline py-4" data-garden-draft>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="t-label-caps flex items-center gap-3 text-bp-ink-primary">
              <Icon name="flag" size={18} className="text-bp-ink-secondary" />
              Draft for review — {draft.derived.length} boundary-critical dimension{draft.derived.length === 1 ? "" : "s"} derived
            </p>
            <Button kind="quiet" onClick={() => setShowDerived((s) => !s)}>
              {showDerived ? "Hide" : "Show"} what
            </Button>
          </div>
          {draft.note && <p className="t-body-sm mt-1 text-bp-ink-secondary">{draft.note}</p>}
          {showDerived && <p className="t-label-md mt-1 text-bp-ink-secondary">{draft.derived.join(" · ")}</p>}
          <p className="t-body-sm mt-1 text-bp-ink-tertiary">Every document built from this plan carries the draft statement until these are measured.</p>
        </div>
      )}

      {items.length > 0 && (
        <section aria-labelledby="existing-on-site-h" className="border border-bp-line-hairline bg-bp-surface-raised p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 id="existing-on-site-h" className="t-label-caps text-bp-ink-tertiary">
              EXISTING ON SITE
            </h2>
            <p className={cn("t-num-sm", undecided.length ? "text-bp-ink-primary" : "text-bp-ink-tertiary")}>
              {undecided.length ? `${undecided.length} undecided` : "all decided"}
            </p>
          </div>
          <p className="t-body-sm mb-3 text-bp-ink-secondary">
            Placed approximately from the client photos. Keep leaves an item out of demolition and new work; remove counts its demolition; replace counts both.
          </p>
          {groups.map((g) => {
            const rows = items.filter((i) => i.table === g.table);
            if (rows.length === 0) return null;
            return (
              <div key={g.table} className="mb-3">
                <p className="t-label-caps mb-1 text-bp-ink-tertiary">{g.label}</p>
                <ul className="border-t border-bp-line-hairline">
                  {rows.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-bp-line-hairline py-2">
                      <span className="t-body-sm min-w-0 text-bp-ink-primary">
                        {item.name}
                        <span className="t-label-md ml-1.5 text-bp-ink-tertiary">{item.kindLabel}</span>
                        {item.dims_derived && <span className="t-label-caps ml-1.5 border border-bp-line-strong px-1 text-bp-ink-secondary">approx.</span>}
                      </span>
                      <span className="inline-flex border border-bp-line-control" role="group" aria-label={`${item.name}: keep, remove or replace`}>
                        {DISPOSITIONS.map((d) => {
                          const active = item.disposition === d.value;
                          return (
                            <button
                              key={d.value}
                              type="button"
                              title={d.hint}
                              disabled={busy === item.id}
                              aria-pressed={active}
                              onClick={() => setDisposition(item, active ? null : d.value)}
                              className={cn(
                                "t-label-md rounded-none border-b-2 px-2.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring disabled:cursor-wait disabled:text-bp-ink-tertiary",
                                active ? "border-bp-brass bg-bp-surface-sunken text-bp-ink-primary" : "border-transparent text-bp-ink-secondary hover:bg-bp-surface-sunken hover:text-bp-ink-primary",
                              )}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      {zones.length > 0 && (
        <section aria-labelledby="levels-heights-h" className="border border-bp-line-hairline bg-bp-surface-raised p-4">
          <h2 id="levels-heights-h" className="t-label-caps mb-2 text-bp-ink-tertiary">
            LEVELS &amp; HEIGHTS
          </h2>
          <p className="t-body-sm mb-3 text-bp-ink-secondary">Finished level against ±000 (blank = not stated — never read as ±000). A structure needs its height for its elevation and its renders.</p>
          <div className="relative overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="t-label-caps py-1 font-normal text-bp-ink-tertiary">Zone</th>
                  <th scope="col" className="t-label-caps py-1 text-right font-normal text-bp-ink-tertiary">Level mm</th>
                  <th scope="col" className="t-label-caps py-1 text-right font-normal text-bp-ink-tertiary">Height mm</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id} className="border-t border-bp-line-hairline">
                    <td className="t-body-sm py-1.5 text-bp-ink-primary">{z.name}</td>
                    <td className="py-1.5 text-right">
                      <input
                        key={`${z.id}:l:${z.level_mm}`}
                        defaultValue={z.level_mm ?? ""}
                        inputMode="numeric"
                        placeholder="—"
                        aria-label={`${z.name} level, mm`}
                        disabled={busy === z.id + "level_mm"}
                        onBlur={(e) => e.target.value !== String(z.level_mm ?? "") && setZone(z.id, "level_mm", e.target.value)}
                        className={`${NUM_FIELD_BASE} w-[80px]`}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      {z.type === "structure" ? (
                        <input
                          key={`${z.id}:h:${z.height_mm}`}
                          defaultValue={z.height_mm ?? ""}
                          inputMode="numeric"
                          placeholder="required"
                          aria-label={`${z.name} height, mm`}
                          aria-invalid={z.height_mm == null ? true : undefined}
                          disabled={busy === z.id + "height_mm"}
                          onBlur={(e) => e.target.value !== String(z.height_mm ?? "") && setZone(z.id, "height_mm", e.target.value)}
                          className={cn(NUM_FIELD_BASE, "w-[80px]", z.height_mm == null && "border-dashed")}
                        />
                      ) : (
                        <span className="t-num-sm text-bp-ink-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ready ? (
        <section aria-labelledby="pack-readiness-h" className="border border-bp-line-hairline bg-bp-surface-raised p-4" data-pack-ready="true">
          <h2 id="pack-readiness-h" className="t-label-caps mb-1 text-bp-ink-tertiary">
            PACK READINESS
          </h2>
          <p className="t-body-sm text-bp-ink-secondary">Every counter has a type and every existing item has a decision — the pack can export.</p>
        </section>
      ) : (
        <section aria-labelledby="pack-readiness-h" className="surface-inverse bg-bp-alert-surface p-4 text-bp-alert-ink" data-pack-ready="false">
          <h2 id="pack-readiness-h" className="t-label-caps mb-1 flex items-center gap-2">
            <Icon name="lock" className="text-[16px]" />
            PACK READINESS — NOT YET
          </h2>
          <ul className="t-body-sm list-disc pl-5">
            {untypedCounters.length > 0 && <li>{untypedCounters.length} counter run{untypedCounters.length === 1 ? "" : "s"} without a type (Elements layer): {untypedCounters.join(", ")}</li>}
            {undecided.length > 0 && <li>{undecided.length} existing item{undecided.length === 1 ? "" : "s"} without keep / remove / replace</li>}
          </ul>
        </section>
      )}

      <section aria-labelledby="friction-log-h" className="border border-bp-line-hairline bg-bp-surface-raised p-4">
        <h2 id="friction-log-h" className="t-label-caps mb-1 text-bp-ink-tertiary">
          FRICTION LOG
        </h2>
        <p className="t-body-sm mb-3 text-bp-ink-secondary">Anything that slowed the design down or needed a workaround. Timestamped; it is pilot data.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Where the friction was" value={frictionArea} onChange={(e) => setFrictionArea(e.target.value)} className={FIELD}>
            {["plan", "elements", "landscape", "lighting", "drainage", "renders", "boq", "pack", "other"].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            value={friction}
            aria-label="What got in the way"
            onChange={(e) => setFriction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && logFriction()}
            placeholder="e.g. could not reshape a run after drawing it"
            className={cn(FIELD, "min-w-[240px] flex-1")}
          />
          <Button kind="secondary" onClick={logFriction} disabled={frictionOff}>
            {frictionSaved ? "Logged" : "Log"}
          </Button>
        </div>
        {frictionOff ? (
          <p id="friction-reason" className="t-label-md mt-1.5 text-bp-ink-tertiary">
            {frictionOff.reason}
          </p>
        ) : null}
      </section>

      {error && (
        <div role="alert" className="surface-inverse bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          <p className="t-body-sm">{error}</p>
        </div>
      )}
    </section>
  );
}

