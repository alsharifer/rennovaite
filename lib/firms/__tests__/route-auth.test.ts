import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// =============================================================================
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
const UNSCOPED_PATHS = ["app/api/projects/[id]/route.ts", "app/api/boq-corrections/route.ts"];

// Store functions that take a Caller (last argument) — every call site must pass one.
const CALLER_TAKING = [
  "listFirms", "createFirm", "findOrCreateFirmByName", "requireFirm", "getFirmSummary", "updateFirm",
  "deleteFirm", "listEntries", "createEntry", "updateEntry", "deleteEntry", "promoteCorrection", "assignProjectFirm",
];

describe("every firm route resolves the caller and passes it to the store", () => {
  it("scans the five firm route files", () => {
    expect(FIRM_ROUTES).toEqual([
      "app/api/firms/[firmId]/promote/route.ts",
      "app/api/firms/[firmId]/rates/[entryId]/route.ts",
      "app/api/firms/[firmId]/rates/route.ts",
      "app/api/firms/[firmId]/route.ts",
      "app/api/firms/route.ts",
    ]);
  });

  it.each([...FIRM_ROUTES, ...UNSCOPED_PATHS])("%s", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src, "imports getCaller").toMatch(/import \{ getCaller \} from "@\/lib\/auth\/caller"/);
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
