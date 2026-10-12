// =============================================================================
// scripts/k8-firms-scratch.mjs — two scratch firms for the pipeline account, so
// /firms shows the list (K8 #10, 63:1094) instead of redirecting to the one
// book. DEV ONLY, through the real routes as the pipeline account.
//
//   node --env-file=.env.local scripts/k8-firms-scratch.mjs seed|teardown [port]
// =============================================================================

import { resolveTarget } from "./_target-guard.mjs";
import { devFetch } from "./lib/dev-auth.mjs";

const [cmd = "seed", port = "3098"] = process.argv.slice(2);
resolveTarget({ script: "k8-firms-scratch", writes: true });
const base = `http://localhost:${port}`;
const f = devFetch("pipeline", { script: "k8-firms-scratch" });
const PREFIX = "K8 scratch firm";

const mine = async () => ((await (await f(`${base}/api/firms`)).json()).firms ?? []).filter((x) => x.name.startsWith(PREFIX));
for (const x of await mine()) await f(`${base}/api/firms/${x.id}`, { method: "DELETE" });
if (cmd === "seed") {
  for (const name of [`${PREFIX} A`, `${PREFIX} B`]) {
    const r = await f(`${base}/api/firms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    if (!r.ok) throw new Error(`create ${name}: ${r.status} ${await r.text()}`);
  }
}
console.log(cmd, (await mine()).map((x) => x.name).join(", ") || "(none)");
