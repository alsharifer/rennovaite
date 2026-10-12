// =============================================================================
// scripts/front-door-check.mjs — the sign-in page is the front door (13 Oct).
//
//   node --env-file=.env.local scripts/front-door-check.mjs http://localhost:3098
//   node scripts/front-door-check.mjs https://rennovaite.fit --anonymous
//
// Anonymous (any deployment, writes nothing):
//   GET and HEAD / and /rennovaite → 307 /auth (never 301/308); following the
//   chain from either ends on /auth with 200 and visits no URL twice; /auth,
//   /privacy and /terms answer 200, say RenovAIte, carry robots noindex and
//   link nowhere that redirects; the callback and a fallen-back magic link
//   still land on /auth; health answers.
// Signed in (dev only — mints the dev pipeline account's session, by Bearer
// AND by the browser's cookie): / , /rennovaite and /auth → 307 /projects.
// =============================================================================

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3098").replace(/\/$/, "");
const anonymousOnly = args.includes("--anonymous");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const rel = (loc) => (loc ? loc.replace(base, "") : loc);

async function get(path, { method = "GET", headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers, redirect: "manual" });
  const text = method === "HEAD" ? "" : await res.text();
  return { status: res.status, location: rel(res.headers.get("location")), text };
}

console.log(`front door — ${base}${anonymousOnly ? " (anonymous only)" : ""}\n\n1. signed out`);
for (const p of ["/", "/rennovaite"]) {
  for (const method of ["GET", "HEAD"]) {
    const r = await get(p, { method });
    check(`${method} ${p} → 307 /auth`, r.status === 307 && r.location === "/auth", `${r.status} ${r.location}`);
  }
  // Follow by hand: a loop shows up as a URL seen twice.
  const seen = [];
  let at = p;
  let last;
  for (let hop = 0; hop < 6 && at; hop++) {
    if (seen.includes(at)) break;
    seen.push(at);
    last = await get(at);
    at = last.status >= 300 && last.status < 400 ? last.location : null;
  }
  check(`${p}: the chain ends on /auth, 200, no loop`, !at && last?.status === 200 && seen.at(-1) === "/auth", seen.join(" → "));
}

for (const p of ["/auth", "/privacy", "/terms"]) {
  const r = await get(p);
  check(`${p} 200`, r.status === 200, `${r.status}`);
  check(`${p} robots noindex`, /<meta name="robots" content="noindex, ?nofollow"/.test(r.text));
  check(`${p} says RenovAIte, not Property OS`, /<title>[^<]*RenovAIte[^<]*<\/title>/.test(r.text) && !/Property OS/.test(r.text));
  const into = [...r.text.matchAll(/href="(\/(?:rennovaite[^"]*)?|\/project[^"]*)"/g)].map((m) => m[1]);
  check(`${p} links nothing into a redirect`, into.length === 0, into.join(", "));
}
const authPage = await get("/auth");
check("/auth title is 'Sign in · RenovAIte'", /<title>Sign in · RenovAIte<\/title>/.test(authPage.text));

const cb = await get("/auth/callback");
check("/auth/callback without a code → /auth?error=missing_code", cb.status === 307 && cb.location === "/auth?error=missing_code", `${cb.status} ${cb.location}`);
const fell = await get("/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
check("a fallen-back expired link on / → /auth?error=link_expired", fell.status === 307 && fell.location === "/auth?error=link_expired", `${fell.status} ${fell.location}`);
const health = await get("/api/health");
check("/api/health 200", health.status === 200, `${health.status}`);

if (!anonymousOnly) {
  console.log("\n2. signed in (dev pipeline account)");
  const { devSession } = await import("./lib/dev-auth.mjs");
  const me = await devSession("pipeline", { script: "front-door-check" });
  const cookie = me.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  for (const [how, headers] of [["bearer", me.headers], ["cookie", { cookie }]]) {
    for (const p of ["/", "/rennovaite", "/auth"]) {
      const r = await get(p, { headers });
      check(`${p} (${how}) → 307 /projects`, r.status === 307 && r.location === "/projects", `${r.status} ${r.location}`);
    }
  }
  const nextKept = await get(`/auth?next=${encodeURIComponent("/firms")}`, { headers: me.headers });
  check("/auth?next=/firms (signed in) → /firms (the same rule)", nextKept.status === 307 && nextKept.location === "/firms", `${nextKept.status} ${nextKept.location}`);
  const evil = await get(`/auth?next=${encodeURIComponent("//evil.example")}`, { headers: me.headers });
  check("/auth?next=//evil.example (signed in) → /projects", evil.status === 307 && evil.location === "/projects", `${evil.status} ${evil.location}`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nFRONT DOOR PASSED");
process.exit(failures ? 1 : 0);
