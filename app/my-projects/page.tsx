import type { SupabaseClient } from "@supabase/supabase-js";

import { AppShell } from "@/components/app/AppShell";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

import { PortfolioBrowser } from "./_components/portfolio-browser";
import {
  ALL_PHASES,
  PHASE_ORDER,
  type Phase,
  type PortfolioProject,
  type SortKey,
} from "./_components/portfolio-types";

export const dynamic = "force-dynamic";

const PAGE_NAME = "My Projects";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type ProjectRow = {
  id: string;
  name: string | null;
  city: string | null;
  budget_aed: number | null;
  status: string | null;
  created_at: string | null;
};

type PlanRow = {
  id: string;
  project_id: string | null;
  parsed_json: unknown;
  created_at: string | null;
};

type BoqRow = {
  id: string;
  project_id: string | null;
  total_aed: number | null;
  created_at: string | null;
};

type RenderRow = {
  id: string;
  project_id: string | null;
  image_url: string | null;
  created_at: string | null;
};

type SelectionRow = {
  id: string;
  project_id: string;
  created_at: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferPhase(state: {
  status: string | null;
  hasPlan: boolean;
  hasRender: boolean;
  hasBoq: boolean;
  hasSelections: boolean;
}): Phase {
  const s = (state.status ?? "").toLowerCase();
  if (s === "completed" || s === "complete" || s === "done") return "Completed";
  if (s === "on_hold" || s === "hold" || s === "paused") return "On hold";
  if (s === "construction" || s === "in_construction") return "In Construction";
  if (s === "handover") return "Handover";
  if (state.hasSelections) return "Bidding";
  if (state.hasBoq) return "BoQ";
  if (state.hasRender || state.hasPlan) return "Design";
  return "Active";
}

// Pick the most recent "anything happened" timestamp for a project.
function latestActivityIso(
  project: ProjectRow,
  latestBoq: BoqRow | null,
  latestRender: RenderRow | null,
  latestSelection: SelectionRow | null,
  latestPlan: PlanRow | null,
): string | null {
  const candidates = [
    project.created_at,
    latestPlan?.created_at ?? null,
    latestRender?.created_at ?? null,
    latestBoq?.created_at ?? null,
    latestSelection?.created_at ?? null,
  ].filter((v): v is string => !!v);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a > b ? a : b));
}

function parseFilterParam(raw: string | string[] | undefined): Set<Phase> {
  if (!raw) return new Set();
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  const tokens = flat
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const result = new Set<Phase>();
  const lookup = new Map(ALL_PHASES.map((p) => [p.toLowerCase(), p] as const));
  for (const t of tokens) {
    const matched = lookup.get(t);
    if (matched) result.add(matched);
  }
  return result;
}

function parseSortParam(raw: string | string[] | undefined): SortKey {
  const flat = Array.isArray(raw) ? raw[0] : raw;
  switch (flat) {
    case "budget":
    case "pipeline":
    case "name":
      return flat;
    default:
      return "updated";
  }
}

function parseViewParam(raw: string | string[] | undefined): "grid" | "list" {
  const flat = Array.isArray(raw) ? raw[0] : raw;
  return flat === "list" ? "list" : "grid";
}

// ---------------------------------------------------------------------------

export default async function MyProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = parseFilterParam(sp.filter);
  const sort = parseSortParam(sp.sort);
  const view = parseViewParam(sp.view);

  const supabase = getSupabaseAdmin();
  const sb = supabase as unknown as SupabaseClient;

  const [projectsRes, plansRes, boqsRes, rendersRes, selectionsRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, city, budget_aed, status, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("plans")
        .select("id, project_id, parsed_json, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("boqs")
        .select("id, project_id, total_aed, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("renders")
        .select("id, project_id, image_url, created_at")
        .order("created_at", { ascending: false }),
      sb
        .from("vendor_selections")
        .select("id, project_id, created_at")
        .order("created_at", { ascending: false })
        .returns<SelectionRow[]>(),
    ]);

  const projects: ProjectRow[] = projectsRes.data ?? [];
  const plans: PlanRow[] = (plansRes.data ?? []) as PlanRow[];
  const boqs: BoqRow[] = (boqsRes.data ?? []) as BoqRow[];
  const renders: RenderRow[] = (rendersRes.data ?? []) as RenderRow[];
  const selections: SelectionRow[] = selectionsRes.data ?? [];

  // Latest row per project (lists are pre-sorted desc by created_at).
  const latestPlanByProject = new Map<string, PlanRow>();
  for (const p of plans) {
    if (p.project_id && !latestPlanByProject.has(p.project_id)) {
      latestPlanByProject.set(p.project_id, p);
    }
  }
  const latestBoqByProject = new Map<string, BoqRow>();
  for (const b of boqs) {
    if (b.project_id && !latestBoqByProject.has(b.project_id)) {
      latestBoqByProject.set(b.project_id, b);
    }
  }
  const latestRenderByProject = new Map<string, RenderRow>();
  for (const r of renders) {
    if (r.project_id && !latestRenderByProject.has(r.project_id)) {
      latestRenderByProject.set(r.project_id, r);
    }
  }
  const latestSelectionByProject = new Map<string, SelectionRow>();
  for (const s of selections) {
    if (!latestSelectionByProject.has(s.project_id)) {
      latestSelectionByProject.set(s.project_id, s);
    }
  }

  // Shape into a PortfolioProject the client component can consume directly.
  const shaped: PortfolioProject[] = projects.map((p) => {
    const plan = latestPlanByProject.get(p.id) ?? null;
    const boq = latestBoqByProject.get(p.id) ?? null;
    const render = latestRenderByProject.get(p.id) ?? null;
    const selection = latestSelectionByProject.get(p.id) ?? null;

    const phase = inferPhase({
      status: p.status,
      hasPlan: !!plan?.parsed_json,
      hasRender: !!render,
      hasBoq: !!boq,
      hasSelections: !!selection,
    });

    return {
      id: p.id,
      name: p.name?.trim() || "Untitled",
      city: p.city ?? null,
      budget_aed: p.budget_aed ?? null,
      phase,
      hero_url: render?.image_url ?? null,
      boq_total_aed: boq?.total_aed ?? null,
      last_updated_at: latestActivityIso(p, boq, render, selection, plan),
      created_at: p.created_at,
    };
  });

  // Counts (unfiltered) — drive the chip badges.
  const counts: Record<"all" | Phase, number> = {
    all: shaped.length,
    Active: 0,
    Design: 0,
    BoQ: 0,
    Bidding: 0,
    "In Construction": 0,
    Handover: 0,
    "On hold": 0,
    Completed: 0,
  };
  for (const p of shaped) counts[p.phase]++;

  // Filter
  const filtered =
    filter.size === 0 ? shaped : shaped.filter((p) => filter.has(p.phase));

  // Sort
  const sorted = [...filtered];
  switch (sort) {
    case "budget":
      sorted.sort((a, b) => (b.budget_aed ?? 0) - (a.budget_aed ?? 0));
      break;
    case "pipeline":
      sorted.sort(
        (a, b) => PHASE_ORDER.indexOf(b.phase) - PHASE_ORDER.indexOf(a.phase),
      );
      break;
    case "name":
      sorted.sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      );
      break;
    default:
      sorted.sort((a, b) =>
        (b.last_updated_at ?? "").localeCompare(a.last_updated_at ?? ""),
      );
  }

  return (
    <AppShell pageName={PAGE_NAME}>
      <PortfolioBrowser
        projects={sorted}
        counts={counts}
        filter={[...filter]}
        sort={sort}
        initialView={view}
      />
    </AppShell>
  );
}
