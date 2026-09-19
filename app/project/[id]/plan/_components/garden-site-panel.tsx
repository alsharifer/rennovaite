"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

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

  return (
    <section className="mt-lg space-y-md" aria-label="Garden site" data-plan-id={planId}>
      {draft.draft && (
        <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-md py-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-body-sm font-semibold text-[#92400E]">
              Draft for review — {draft.derived.length} boundary-critical dimension{draft.derived.length === 1 ? "" : "s"} derived
            </p>
            <button type="button" onClick={() => setShowDerived((s) => !s)} className="text-[12px] text-[#92400E] underline decoration-dotted underline-offset-2">
              {showDerived ? "Hide" : "Show"} what
            </button>
          </div>
          {draft.note && <p className="mt-1 text-[12px] text-[#92400E]">{draft.note}</p>}
          {showDerived && <p className="mt-1 font-mono text-[11px] leading-5 text-[#92400E]">{draft.derived.join(" · ")}</p>}
          <p className="mt-1 text-[12px] text-ink-700">Every document built from this plan carries the draft statement until these are measured.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-xl border border-ink-100 bg-paper p-md">
          <div className="mb-sm flex items-baseline justify-between">
            <p className="label-caps text-ink-500">Existing on site</p>
            <p className={cn("font-mono text-[12px] tabular-nums", undecided.length ? "text-[#9A3412]" : "text-ink-500")}>
              {undecided.length ? `${undecided.length} undecided` : "all decided"}
            </p>
          </div>
          <p className="mb-sm text-[12px] text-ink-500">
            Placed approximately from the client photos. Keep leaves an item out of demolition and new work; remove counts its demolition; replace counts both.
          </p>
          {groups.map((g) => {
            const rows = items.filter((i) => i.table === g.table);
            if (rows.length === 0) return null;
            return (
              <div key={g.table} className="mb-sm">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{g.label}</p>
                <ul className="divide-y divide-ink-100">
                  {rows.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 text-[13px] text-ink-900">
                        {item.name}
                        <span className="ml-1.5 text-[11px] text-ink-500">{item.kindLabel}</span>
                        {item.dims_derived && <span className="ml-1.5 rounded-full bg-[#FEF3C7] px-1.5 py-px text-[10px] font-medium text-[#92400E]">approx.</span>}
                      </span>
                      <span className="inline-flex gap-0.5 rounded-lg border border-ink-100 bg-canvas p-0.5">
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
                                "focus-ring rounded-md px-2 py-0.5 text-[12px] transition-colors disabled:opacity-50",
                                active ? (d.value === "remove" ? "bg-[#9A3412] text-white" : "bg-brass-600 text-on-primary") : "text-ink-700 hover:bg-surface-container",
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
        </div>
      )}

      {zones.length > 0 && (
        <div className="rounded-xl border border-ink-100 bg-paper p-md">
          <p className="label-caps mb-sm text-ink-500">Levels &amp; heights</p>
          <p className="mb-sm text-[12px] text-ink-500">Finished level against ±000 (blank = not stated — never read as ±000). A structure needs its height for its elevation and its renders.</p>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-500">
                <th className="py-1 font-medium">Zone</th>
                <th className="py-1 text-right font-medium">Level mm</th>
                <th className="py-1 text-right font-medium">Height mm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {zones.map((z) => (
                <tr key={z.id}>
                  <td className="py-1 text-ink-900">{z.name}</td>
                  <td className="py-1 text-right">
                    <input
                      key={`${z.id}:l:${z.level_mm}`}
                      defaultValue={z.level_mm ?? ""}
                      inputMode="numeric"
                      placeholder="—"
                      disabled={busy === z.id + "level_mm"}
                      onBlur={(e) => e.target.value !== String(z.level_mm ?? "") && setZone(z.id, "level_mm", e.target.value)}
                      className="focus-ring w-[80px] rounded border border-ink-100 bg-paper px-1.5 py-0.5 text-right font-mono tabular-nums"
                    />
                  </td>
                  <td className="py-1 text-right">
                    {z.type === "structure" ? (
                      <input
                        key={`${z.id}:h:${z.height_mm}`}
                        defaultValue={z.height_mm ?? ""}
                        inputMode="numeric"
                        placeholder="required"
                        disabled={busy === z.id + "height_mm"}
                        onBlur={(e) => e.target.value !== String(z.height_mm ?? "") && setZone(z.id, "height_mm", e.target.value)}
                        className={cn("focus-ring w-[80px] rounded border bg-paper px-1.5 py-0.5 text-right font-mono tabular-nums", z.height_mm == null ? "border-[#FDBA74]" : "border-ink-100")}
                      />
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={cn("rounded-xl border p-md", ready ? "border-ink-100 bg-paper" : "border-[#FDBA74] bg-[#FFF7ED]")}>
        <p className="label-caps mb-1 text-ink-500">Pack readiness</p>
        {ready ? (
          <p className="text-[13px] text-ink-700">Every counter has a type and every existing item has a decision — the pack can export.</p>
        ) : (
          <ul className="list-disc pl-5 text-[13px] text-[#9A3412]">
            {untypedCounters.length > 0 && <li>{untypedCounters.length} counter run{untypedCounters.length === 1 ? "" : "s"} without a type (Elements layer): {untypedCounters.join(", ")}</li>}
            {undecided.length > 0 && <li>{undecided.length} existing item{undecided.length === 1 ? "" : "s"} without keep / remove / replace</li>}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-ink-100 bg-paper p-md">
        <p className="label-caps mb-1 text-ink-500">Friction log</p>
        <p className="mb-sm text-[12px] text-ink-500">Anything that slowed the design down or needed a workaround. Timestamped; it is pilot data.</p>
        <div className="flex flex-wrap gap-2">
          <select value={frictionArea} onChange={(e) => setFrictionArea(e.target.value)} className="focus-ring rounded border border-ink-100 bg-paper px-2 py-1 text-[13px]">
            {["plan", "elements", "landscape", "lighting", "drainage", "renders", "boq", "pack", "other"].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            value={friction}
            onChange={(e) => setFriction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && logFriction()}
            placeholder="e.g. could not reshape a run after drawing it"
            className="focus-ring min-w-[240px] flex-1 rounded border border-ink-100 bg-paper px-2 py-1 text-[13px]"
          />
          <button type="button" onClick={logFriction} disabled={busy === "friction" || friction.trim().length < 3} className="focus-ring rounded-lg bg-brass-600 px-3 py-1 text-[13px] font-semibold text-on-primary disabled:opacity-50">
            {frictionSaved ? "Logged" : "Log"}
          </button>
        </div>
      </div>

      {error && <p className="text-[12px] text-error">{error}</p>}
    </section>
  );
}
