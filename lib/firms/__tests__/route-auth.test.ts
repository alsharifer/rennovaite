import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE_FILES, PUBLIC_SERVER_ACTION_FILES } from "@/lib/auth/access";

// =============================================================================
// H1 (below the U1 blocks) — EVERY route handler outside the public allowlist
// in lib/auth/access.ts resolves the caller and refuses a null one before it
// does anything else; so does every server action.
//
// U1 — no firm route is reachable without membership.
//
// A static scan, in the style of the T5 ungated-paths test: every handler under
// app/api/firms resolves the caller with getCaller(request) and hands it to the
// store, whose requireFirm answers 401 / 403 / 404. The two unscoped
// firm-touching paths U0 found (project firm assignment, correction
// attribution) do the same. If a new handler is added without the caller, this
// fails before a request ever does.
// =============================================================================

const ROOT = path.resolve(__dirname, "../../..");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

const FIRM_ROUTES = walk(path.join(ROOT, "app/api/firms")).map(rel).sort();
// U4 adds the approval route: a project with a firm is that firm's to approve.
const UNSCOPED_PATHS = ["app/api/projects/[id]/route.ts", "app/api/boq-corrections/route.ts", "app/api/projects/[id]/boq-approvals/route.ts", "app/api/projects/[id]/reference-basis/route.ts"];

// Store functions that take a Caller (last argument) — every call site must pass one.
const CALLER_TAKING = [
  "listFirms", "createFirm", "findOrCreateFirmByName", "requireFirm", "getFirmSummary", "updateFirm",
  "deleteFirm", "listEntries", "createEntry", "updateEntry", "deleteEntry", "promoteCorrection", "assignProjectFirm",
  // U4
  "listEntryHistory", "recordApproval",
  // L4
  "getBranding", "updateBranding", "setLogo", "acceptReferenceBasis",
];

describe("every firm route resolves the caller and passes it to the store", () => {
  it("scans every firm route file (five from L1/U1, four quote routes from U3, the history route from U4, the branding route from L4)", () => {
    expect(FIRM_ROUTES).toEqual([
      "app/api/firms/[firmId]/branding/route.ts",
      "app/api/firms/[firmId]/promote/route.ts",
      "app/api/firms/[firmId]/quotes/[quoteId]/lines/[lineId]/route.ts",
      "app/api/firms/[firmId]/quotes/[quoteId]/route.ts",
      "app/api/firms/[firmId]/quotes/route.ts",
      "app/api/firms/[firmId]/quotes/template/route.ts",
      "app/api/firms/[firmId]/rates/[entryId]/route.ts",
      "app/api/firms/[firmId]/rates/history/route.ts",
      "app/api/firms/[firmId]/rates/route.ts",
      "app/api/firms/[firmId]/route.ts",
      "app/api/firms/route.ts",
    ]);
  });

  it.each([...FIRM_ROUTES, ...UNSCOPED_PATHS])("%s", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src, "imports getCaller").toMatch(/import \{ getCaller(, unauthenticated)? \} from "@\/lib\/auth\/caller"/);
    // Every exported handler in a firm route calls getCaller(request).
    if (file.startsWith("app/api/firms/")) {
      const handlers = src.match(/export async function (GET|POST|PATCH|DELETE)\(/g) ?? [];
      const calls = src.match(/await getCaller\(request\)/g) ?? [];
      expect(handlers.length, "handlers").toBeGreaterThan(0);
      expect(calls.length, "one getCaller per handler").toBe(handlers.length);
    }
    // No call to a caller-taking store function omits the caller: the call
    // statement (up to the next `;` or line break) must end its argument list
    // with the resolved caller.
    for (const fn of CALLER_TAKING) {
      const re = new RegExp(`\\b${fn}\\([^;\\n]*`, "g");
      for (const m of src.matchAll(re)) {
        if (m[0].startsWith(`${fn}(`) && /^\w+\($/.test(m[0])) continue; // an import line, not a call
        expect(m[0], `${fn} call carries the caller`).toMatch(/,\s*(caller|await getCaller\(request\))\)/);
      }
    }
    // Nothing reads the caller from the body — the client does not get to say who it is.
    expect(src).not.toMatch(/body\.(data\.)?(user_id|caller|member)/);
  });
});

describe("the store's own contract", () => {
  const store = readFileSync(path.join(ROOT, "lib/firms/store.ts"), "utf8");

  it("requireFirm answers 401, then 404, then 403 — in that order", () => {
    const i401 = store.indexOf('new StoreError(401, "unauthenticated"');
    const body = store.slice(store.indexOf("export async function requireFirm"));
    const i404 = body.indexOf('new StoreError(404, "firm_not_found"');
    const i403 = body.indexOf('new StoreError(403, "not_a_member"');
    expect(i401).toBeGreaterThan(-1);
    expect(i404).toBeGreaterThan(-1);
    expect(i403).toBeGreaterThan(i404);
    expect(body.indexOf("requireCaller(caller)")).toBeLessThan(i404);
  });

  it("listFirms is the caller's firms, never a bare select of every firm", () => {
    const body = store.slice(store.indexOf("export async function listFirms"), store.indexOf("export async function requireFirm"));
    expect(body).toMatch(/memberFirmIds/);
    expect(body).toMatch(/\.in\("id", ids\)/);
  });

  it("creating a firm makes the caller a member", () => {
    const body = store.slice(store.indexOf("export async function createFirm"), store.indexOf("export async function findOrCreateFirmByName"));
    expect(body).toMatch(/addMember\(db, firm\.id, who\.id\)/);
  });
});

// =============================================================================
// H1 — a session everywhere.
//
// proxy.ts turns anonymous requests away before a route runs, but a proxy can
// be skipped (a matcher change, a dot in a dynamic segment), so the handlers do
// not rely on it: every exported handler in every route file outside
// PUBLIC_ROUTE_FILES opens with
//
//     const caller = await getCaller(request);
//     if (!caller) return unauthenticated(…);
//
// and awaits nothing before it except its own route params — no body read, no
// lookup, no side effect happens for an anonymous caller. A new route that
// forgets fails here.
// =============================================================================

const ALL_ROUTES = [...walk(path.join(ROOT, "app/api")), ...walk(path.join(ROOT, "app/auth"))].map(rel).sort();
const GUARDED_ROUTES = ALL_ROUTES.filter((f) => !(f in PUBLIC_ROUTE_FILES));

interface Handler {
  name: string;
  param: string | null;
  body: string;
}

/** Top-level `export async function NAME(param…) { … }` blocks, body only. */
function exportedFunctions(src: string, names: RegExp): Handler[] {
  const out: Handler[] = [];
  for (const m of src.matchAll(/^export async function (\w+)\(/gm)) {
    if (!names.test(m[1]!)) continue;
    // The parameter list, balancing parens; the body starts at the next "{".
    let i = m.index! + m[0].length;
    for (let depth = 1; depth > 0 && i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    const params = src.slice(m.index! + m[0].length, i - 1);
    const open = src.indexOf("{", src.indexOf(")", i - 1));
    const close = src.indexOf("\n}", open);
    const first = /^\s*([A-Za-z_$][\w$]*)/.exec(params)?.[1] ?? null;
    out.push({ name: m[1]!, param: first, body: src.slice(open + 1, close === -1 ? undefined : close) });
  }
  return out;
}

const HTTP_METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;

/** Every `await` before `index`, minus awaiting the route's own params. */
function awaitsBefore(body: string, index: number): string[] {
  return [...body.slice(0, index).matchAll(/\bawait\s+([^;\n]*)/g)]
    .map((a) => a[1]!.trim())
    .filter((a) => !/^(?:\w+\.)?params\b/.test(a));
}

describe("H1: every route outside the public allowlist requires a signed-in caller", () => {
  it("the allowlist names real route files, each with a reason", () => {
    for (const [file, reason] of Object.entries(PUBLIC_ROUTE_FILES)) {
      expect(ALL_ROUTES, file).toContain(file);
      expect(reason.length, file).toBeGreaterThan(10);
    }
    // The callback is the only way to obtain a session, health the only probe.
    expect(Object.keys(PUBLIC_ROUTE_FILES).sort()).toEqual(["app/api/health/route.ts", "app/auth/callback/route.ts"]);
  });

  it("scans every API route file", () => {
    // 61 at H1. A new route is scanned automatically; this floor catches a
    // walk that silently stopped finding them.
    expect(GUARDED_ROUTES.filter((f) => f.startsWith("app/api/")).length).toBeGreaterThanOrEqual(60);
  });

  it.each(GUARDED_ROUTES)("%s", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    // Handlers declared any other way (export const GET = …, re-exports) cannot be scanned.
    expect(src, "handlers are `export async function`").not.toMatch(/export\s+(const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
    expect(src, "no re-exported handlers").not.toMatch(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[^}]*\}/);
    expect(src, "imports getCaller + unauthenticated").toMatch(/import \{[^}]*\bgetCaller, [^}]*\bunauthenticated \} from "@\/lib\/auth\/caller"/);

    const handlers = exportedFunctions(src, HTTP_METHODS);
    expect(handlers.length, "handlers").toBeGreaterThan(0);
    for (const h of handlers) {
      expect(h.param, `${h.name} takes the request`).not.toBeNull();
      const guard = new RegExp(`const caller = await getCaller\\(${h.param}\\);\\s*if \\(!caller\\) return unauthenticated\\(`);
      const m = guard.exec(h.body);
      expect(m, `${h.name} opens with getCaller(${h.param}) + unauthenticated()`).not.toBeNull();
      expect(awaitsBefore(h.body, m!.index), `${h.name}: nothing awaited before the caller check`).toEqual([]);
    }
  });
});

// Server actions are POSTs to a page: the proxy lets a signed-in page through
// but cannot tell which action rides on it, so each action checks for itself.
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const SERVER_ACTION_FILES = walkFiles(path.join(ROOT, "app"))
  .filter((p) => /^\s*(\/\/[^\n]*\n\s*)*["']use server["']/.test(readFileSync(p, "utf8")))
  .map(rel)
  .sort();

describe("H1: every server action outside the public allowlist requires a signed-in caller", () => {
  it("finds the server actions, and the public ones exist", () => {
    expect(SERVER_ACTION_FILES.length).toBeGreaterThanOrEqual(3);
    for (const file of Object.keys(PUBLIC_SERVER_ACTION_FILES)) expect(SERVER_ACTION_FILES, file).toContain(file);
  });

  it.each(SERVER_ACTION_FILES.filter((f) => !(f in PUBLIC_SERVER_ACTION_FILES)))("%s", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src).toMatch(/import \{ getCaller \} from "@\/lib\/auth\/caller"/);
    const actions = exportedFunctions(src, /./);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      const m = /const caller = await getCaller\(\);\s*if \(!caller\) return /.exec(a.body);
      expect(m, `${a.name} opens with getCaller()`).not.toBeNull();
      expect(awaitsBefore(a.body, m!.index), `${a.name}: nothing awaited before the caller check`).toEqual([]);
    }
  });
});
