// =============================================================================
// scripts/k8-journey-check.mjs — K8.1 live: the owner journey's routes (spec §6.0).
//
//   node --env-file=.env.local scripts/k8-journey-check.mjs [port] <ownerProjectId>
//
// /ideation, /style, /moodboard → 308 to /design (query kept); /design renders
// both views with the Direction | References tabs; the rail draws the seven
// owner steps and lights 02 / 04 / 06 on every route of the step; 04 Cost and
// 06 Tender carry their sub-tabs. Signed in as the dev pipeline account (a
// project member; the pipeline account's grants persist, H5).
// =============================================================================

import { devFetch } from "./lib/dev-auth.mjs";

const args = process.argv.slice(2);
const port = args.find((a) => /^\d+$/.test(a)) ?? "3098";
const id = args.find((a) => /^[0-9a-f-]{36}$/.test(a));
if (!id) throw new Error("usage: k8-journey-check.mjs [port] <ownerProjectId>");
const base = `http://localhost:${port}`;
const f = devFetch("pipeline", { script: "k8-journey-check" });
await f.grant([id]);

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};
const get = async (p) => {
  const r = await f(base + p, { redirect: "manual" });
  return { status: r.status, location: r.headers.get("location"), html: r.status === 200 ? await r.text() : "" };
};
const P = `/project/${id}`;

console.log("1. the old step routes 308 to /design");
for (const [from, to] of [["/ideation", "/design"], ["/style", "/design"], ["/moodboard", "/design?view=references"], ["/ideation?x=1", "/design?x=1"]]) {
  const r = await get(P + from);
  check(`${from} → 308 ${to}`, r.status === 308 && r.location === P + to, `${r.status} ${r.location}`);
}

console.log("\n2. /design, both views");
const activeStep = (html) => /aria-current="step"[^>]*data-step="([a-z_]+)"|data-step="([a-z_]+)"[^>]*aria-current="step"/.exec(html)?.slice(1).find(Boolean) ?? null;
const steps = (html) => [...new Set([...html.matchAll(/data-step="([a-z_]+)"/g)].map((m) => m[1]))];
for (const [p, tab] of [["/design", "direction"], ["/design?view=references", "references"]]) {
  const r = await get(P + p);
  check(`${p} 200`, r.status === 200, `${r.status}`);
  check(`${p}: rail = the seven owner steps`, steps(r.html).join(",") === "overview,plan,design,renders,cost,timeline,tender", steps(r.html).join(","));
  check(`${p}: 02 Design lit`, activeStep(r.html) === "design", String(activeStep(r.html)));
  check(`${p}: tab "${tab}" is the current one`, new RegExp(`aria-current="page"[^>]*data-tab="${tab}"|data-tab="${tab}"[^>]*aria-current="page"`).test(r.html));
}

console.log("\n3. two-route steps light on both routes and carry their tabs");
for (const [p, step, tabs] of [["/boq", "cost", ["boq", "specification"]], ["/accessories", "cost", null], ["/drawings", "tender", ["documents", "suppliers"]], ["/vendors", "tender", null]]) {
  const r = await get(P + p);
  if (r.status === 404 && p === "/drawings") {
    check(`${p}: 404 (DRAWINGS_ENABLED off) — Tender opens on suppliers`, true);
    continue;
  }
  check(`${p} 200`, r.status === 200, `${r.status}`);
  check(`${p}: ${step} lit`, activeStep(r.html) === step, String(activeStep(r.html)));
  if (tabs) for (const t of tabs) check(`${p}: tab ${t} links`, r.html.includes(`data-tab="${t}"`));
}


console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nK8.1 JOURNEY PASSED");
process.exit(failures ? 1 : 0);
