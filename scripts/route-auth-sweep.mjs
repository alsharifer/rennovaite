#!/usr/bin/env node
// =============================================================================
// scripts/route-auth-sweep.mjs — H1, live: is a session required everywhere?
//
//   node scripts/route-auth-sweep.mjs [port]
//
// Derives every route handler (app/api/**/route.ts + app/auth/callback) and
// every page (app/**/page.tsx) from the filesystem — no hand-kept list — and
// against a running dev server checks:
//
//   1. every API method, ANONYMOUS          → 401 { code: "unauthenticated" }
//      except the public allowlist (lib/auth/access.ts), which answers;
//   2. the same with a forged / expired Bearer token → 401;
//   3. a dot in a dynamic segment (the page matcher's static-file carve-out)
//      is still gated → 401;
//   4. every page, anonymous → 307 to /auth?next=<the page>, except the public
//      pages, which render;
//   5. signed in (the dev "pipeline" account, scripts/lib/dev-auth.mjs): every
//      GET handler gets past the gate (anything but 401) and a page renders.
//
// Dynamic segments are filled with a random UUID, so no real row is addressed.
// Anonymous calls send an empty JSON body; they never reach a handler. The
// signed-in pass sends GETs only (read-only by construction). Exit 1 on any
// failure.
// =============================================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { devSession } from "./lib/dev-auth.mjs";

const port = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${port}`;
const ROOT = process.cwd();

// Mirrors lib/auth/access.ts. Literal on purpose: a sweep that imported the
// allowlist it checks would pass whatever the allowlist became.
const PUBLIC_ROUTES = new Set(["app/api/health/route.ts", "app/auth/callback/route.ts"]);
const PUBLIC_PAGES = new Set(["/", "/rennovaite", "/auth", "/privacy", "/terms"]);

function walk(dir, name, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, name, out);
    else if (n === name) out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}

const fill = (file) =>
  "/" +
  file
    .replace(/^app\//, "")
    .replace(/\/(route\.ts|page\.tsx)$/, "")
    .replace(/(^|\/)page\.tsx$/, "")
    .replace(/\[[^\]]+\]/g, () => randomUUID());

let failures = 0;
const rows = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  rows.push(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function call(method, url, headers = {}) {
  const init = { method, headers: { ...headers }, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.headers["content-type"] = "application/json";
    init.body = "{}";
  }
  const res = await fetch(url, init);
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, location: res.headers.get("location") };
}

// --- the census --------------------------------------------------------------
const routeFiles = [...walk(path.join(ROOT, "app/api"), "route.ts"), ...walk(path.join(ROOT, "app/auth"), "route.ts")].sort();
const handlers = [];
for (const file of routeFiles) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const m of src.matchAll(/^export async function (GET|POST|PUT|PATCH|DELETE)\(/gm)) handlers.push({ file, method: m[1] });
}
const apiFiles = routeFiles.filter((f) => f.startsWith("app/api/"));
console.log(`census: ${apiFiles.length} API route files, ${handlers.length} handlers (incl. the auth callback); ${handlers.filter((h) => !PUBLIC_ROUTES.has(h.file)).length} must refuse an anonymous caller`);

// --- 1 + 2. every API method, anonymous and forged ---------------------------------
console.log("\n1–2. API handlers: anonymous, then a forged Bearer");
const FORGED = [
  "Bearer not-a-jwt",
  // A well-formed but unsigned token for a made-up user, long expired.
  "Bearer " + [{ alg: "HS256", typ: "JWT" }, { sub: randomUUID(), role: "authenticated", exp: 1_000_000_000 }].map((o) => Buffer.from(JSON.stringify(o)).toString("base64url")).join(".") + ".c2lnbmF0dXJl",
];
let anon401 = 0;
for (const h of handlers) {
  if (h.file === "app/auth/callback/route.ts") continue; // a page-path handler; step 4
  const url = BASE + fill(h.file);
  const r = await call(h.method, url);
  if (PUBLIC_ROUTES.has(h.file)) {
    check(`${h.method} ${fill(h.file)} (public) answers anonymously`, r.status === 200, `${r.status}`);
    continue;
  }
  const ok = r.status === 401 && r.body?.code === "unauthenticated";
  if (ok) anon401++;
  check(`${h.method} ${h.file.replace(/^app/, "").replace(/\/route\.ts$/, "")} anonymous → 401`, ok, ok ? "" : `${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`);
  for (const auth of FORGED) {
    const f = await call(h.method, url, { authorization: auth });
    if (f.status !== 401) check(`${h.method} ${h.file} with a forged token → 401`, false, `${f.status}`);
  }
}
check(`every off-allowlist API handler refused anonymously (${anon401})`, anon401 === handlers.filter((h) => !PUBLIC_ROUTES.has(h.file)).length);
check("forged / expired Bearer tokens → 401 on every off-allowlist handler", true);

// Health: public, but no key fingerprints for a stranger.
const health = await call("GET", `${BASE}/api/health`);
check("health (anonymous) carries presence only — no key fingerprints", health.status === 200 && health.body?.signed_in === false && !JSON.stringify(health.body).includes("fingerprint"));

// --- 3. matcher edge cases -----------------------------------------------------
console.log("\n3. matcher edges");
for (const p of [`/api/projects/${randomUUID()}.png/boq-pdf`, "/api/projects/x.json", `/api/render/status.txt`, "/api/does-not-exist", "/api", `/api/firms/${randomUUID()}/rates/`]) {
  let r = await call("GET", BASE + p);
  // Next normalises a trailing slash with a 308 before any proxy runs; follow
  // that one hop — the canonical path is what must be gated.
  if (r.status === 308 && r.location) r = await call("GET", new URL(r.location, BASE).href);
  check(`GET ${p} anonymous → 401`, r.status === 401, `${r.status}`);
}

// --- 4. pages ----------------------------------------------------------------------
console.log("\n4. pages, anonymous");
const pages = walk(path.join(ROOT, "app"), "page.tsx").map((f) => (f === "app/page.tsx" ? "/" : fill(f)));
let redirected = 0;
for (const p of pages) {
  const r = await call("GET", BASE + p);
  if (PUBLIC_PAGES.has(p)) {
    check(`${p} (public) renders`, r.status === 200, `${r.status}`);
    continue;
  }
  const want = `/auth?next=${encodeURIComponent(p)}`;
  const ok = r.status === 307 && (r.location === want || r.location === BASE + want);
  if (ok) redirected++;
  check(`${p.replace(/[0-9a-f-]{36}/g, "[id]")} → 307 /auth?next=…`, ok, ok ? "" : `${r.status} ${r.location}`);
}
const cb = await call("GET", `${BASE}/auth/callback`);
check("/auth/callback (public) runs without a session (no code → back to /auth)", cb.status === 307 && /\/auth\?error=missing_code$/.test(cb.location ?? ""), `${cb.status} ${cb.location}`);

// --- 5. signed in ----------------------------------------------------------------
console.log("\n5. signed in (dev pipeline account)");
const me = await devSession("pipeline", { script: "route-auth-sweep" });
let passed = 0;
const gets = handlers.filter((h) => h.method === "GET" && !PUBLIC_ROUTES.has(h.file));
for (const h of gets) {
  const r = await call("GET", BASE + fill(h.file), me.headers);
  if (r.status !== 401) passed++;
  else check(`GET ${h.file} signed in gets past the gate`, false, `401 ${JSON.stringify(r.body)?.slice(0, 120)}`);
}
check(`every GET handler lets a signed-in caller through (${passed}/${gets.length})`, passed === gets.length);
const healthIn = await call("GET", `${BASE}/api/health`, me.headers);
check("health (signed in) carries the fingerprints", healthIn.body?.signed_in === true && JSON.stringify(healthIn.body).includes("fingerprint"));
const page = await call("GET", `${BASE}/project`, me.headers);
check("a gated page renders for a signed-in caller", page.status === 200, `${page.status}`);

console.log(rows.join("\n"));
console.log(failures === 0 ? `\nALL CHECKS PASSED — ${anon401} API handlers refuse anonymous callers; ${redirected} pages redirect to sign-in` : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
