import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_PAGE_PATHS } from "@/lib/auth/access";

// =============================================================================
// K8 route scan (spec §6: "route-scan must find zero Atelier shells").
//
// Every page under app/ is found from the filesystem. An AUTHENTICATED page must
// either redirect (and render nothing), or render inside the Blueprint shell —
// ProjectShell / AccountShell in a layout above it, or in the page itself.
//
// Atelier tokens: every page's module graph (its own files and every local
// component it imports, transitively) is scanned for Atelier classes and
// helpers. The pages that still use them are listed in ATELIER_PENDING, each
// with the K8 task that rebuilds it; the list must equal what the scan finds,
// so it can only shrink — and it is empty when K8 is done (Part 3, dark, waits
// for that). Parked marketing components are outside the scan: nothing routes
// to them.
// =============================================================================

const ROOT = process.cwd();
const APP = path.join(ROOT, "app");

function walk(dir: string, name: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, name, out);
    else if (n === name) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const routeOf = (file: string) => "/" + rel(path.dirname(file)).replace(/^app\/?/, "").replace(/\([^)]+\)\/?/g, "");
const pages = walk(APP, "page.tsx").map((f) => ({ file: f, route: routeOf(f).replace(/\/$/, "") || "/" }));

// Pages a visitor sees signed out (the allowlist) and the dev-only sandboxes.
const PUBLIC = new Set(PUBLIC_PAGE_PATHS);
const authenticated = pages.filter((p) => !PUBLIC.has(p.route) && !p.route.startsWith("/dev/"));

const SHELL = /<(ProjectShell|AccountShell)\b/;
const REDIRECT_ONLY = /\b(redirect|permanentRedirect|frontDoorRedirect|redirectToProjectsHome)\(/;

function layoutsAbove(file: string): string[] {
  const out: string[] = [];
  for (let d = path.dirname(file); d.startsWith(APP); d = path.dirname(d)) {
    const l = path.join(d, "layout.tsx");
    if (existsSync(l)) out.push(l);
  }
  return out;
}

/** A page that renders no JSX of its own — it only redirects. */
function redirectOnly(src: string): boolean {
  return REDIRECT_ONLY.test(src) && !/return\s*\(?\s*</.test(src) && !/=>\s*</.test(src);
}

// --- the module graph ----------------------------------------------------------------

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Local UI files a page pulls in (app/ and components/ only — lib/ draws nothing). */
function uiGraph(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const r = resolve(f, (m[1] ?? m[2])!);
      if (!r) continue;
      const rr = rel(r);
      if (!/^(app|components)\//.test(rr) || /^components\/marketing\//.test(rr)) continue;
      stack.push(r);
    }
  }
  return [...seen];
}

// Atelier classes and helpers. Blueprint's own names (t-label-caps, t-body-md,
// bp-*) are excluded by the lookbehind.
const ATELIER = /(?<![\w-])(bg-canvas|bg-paper|bg-bone|text-ink-(?:900|700|500)|border-ink-100|[a-z]+-brass-600|font-display|text-headline-[a-z-]+|text-body-(?:lg|md|sm)|text-display-hero|label-caps|material-symbols-outlined|matte-image|shadow-level-[12]|shadow-hairline|on-surface(?:-variant)?|surface-container[a-z-]*|AtelierCanvas|focus-ring)(?![\w-])/;

function atelierUse(entry: string): string[] {
  return uiGraph(entry)
    .filter((f) => ATELIER.test(readFileSync(f, "utf8")))
    .map(rel)
    .sort();
}

/**
 * Pages whose module graph still draws Atelier, with the K8 task that rebuilds
 * them. Must equal the scan — remove a route here when its screen lands.
 */
const ATELIER_PENDING: Record<string, string> = {

  "/project/[id]/render": "#5 Renders studio (57:612)",
  "/project/[id]/accessories": "#6 Specification (58:738)",
  "/project/[id]/timeline": "#7 Timeline (59:837)",
  "/project/[id]/vendors": "#8 Contractors & suppliers (60:913)",
  "/project/[id]/viewer": "#9 3D view (62:1017)",
  "/firms": "#10 Rate books list (63:1094)",
  "/project/new": "#12 intake → Reading your plan (63:4510) — the plot-size fields",
  "/project/[id]/plan": "plan editor canvas internals + garden panel (24:814 — K5 restyled only the chrome)",
  "/project/[id]/drawings": "the plan editor's read mode on 06 Documents (same canvas internals as /plan)",
};

describe("K8 route scan — one shell everywhere", () => {
  it("finds the pages from the filesystem", () => {
    expect(authenticated.length).toBeGreaterThan(20);
    expect(authenticated.map((p) => p.route)).toContain("/projects");
  });

  it("the Atelier shell is gone", () => {
    for (const f of ["components/app/AppShell.tsx", "components/app/Sidebar.tsx", "components/app/TopBar.tsx", "components/app/JourneyChrome.tsx"]) {
      expect(existsSync(path.join(ROOT, f)), f).toBe(false);
    }
    for (const p of pages) {
      for (const f of uiGraph(p.file)) {
        expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/components\/app\/(AppShell|Sidebar|TopBar|JourneyChrome)/);
      }
    }
  });

  it("every authenticated page redirects or renders inside the Blueprint shell", () => {
    const bad = authenticated
      .filter((p) => {
        const src = readFileSync(p.file, "utf8");
        if (redirectOnly(src)) return false;
        return !SHELL.test(src) && !layoutsAbove(p.file).some((l) => SHELL.test(readFileSync(l, "utf8")));
      })
      .map((p) => p.route);
    expect(bad).toEqual([]);
  });

  it("Atelier tokens remain only on the pages still waiting for their K8 task", () => {
    const found = Object.fromEntries(
      authenticated
        .filter((p) => !redirectOnly(readFileSync(p.file, "utf8")))
        .map((p) => [p.route, atelierUse(p.file)] as const)
        .filter(([, files]) => files.length > 0),
    );
    expect(Object.keys(found).sort()).toEqual(Object.keys(ATELIER_PENDING).sort());
  });
});
