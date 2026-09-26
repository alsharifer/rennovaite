// =============================================================================
// scripts/kg/equivalence-check.ts — run the KG queries the app ACTUALLY issues
// against two instances and diff the results.
//
//   KG_TARGET_URI=... KG_TARGET_USER=... KG_TARGET_PASSWORD=... \
//   node --import ./scripts/_alias-hook.mjs scripts/kg/equivalence-check.ts [--print]
//
// "The queries the app issues" means exactly `retrieveContextBundle` from the
// vendored agent (kg/retrieval/agent.ts), fed by `resolveBrief`
// (lib/kg/brief.ts) — the only code path through which a render or BoQ prompt
// reaches Neo4j. resolveBrief maps the six interior style keys onto six briefs
// against the one seeded slice (Mudon Al Naseem × 4BR first floor), so six
// bundles per instance cover every request the app can make today.
//
// Comparison is on the bundle with `bundleId` removed (it is a timestamp+nonce
// minted per call). A difference in ORDER among equal scores is reported
// separately from a difference in CONTENT: the agent's `ORDER BY score DESC
// LIMIT n` leaves ties to the planner, so tie order can differ between two
// instances (and between two runs on one), and that is not a migration defect —
// but a different SET of materials or fixtures would be.
//
// The agent keeps a module-level driver singleton that reads NEO4J_* on first
// use; the script points those variables at each instance in turn and calls
// closeDriver() between them, so the app code is exercised unchanged.
// =============================================================================
import { closeDriver, retrieveContextBundle, formatBundleForPrompt, type ContextBundle } from "@/kg/retrieval/agent";
import { resolveBrief } from "@/lib/kg/brief";
import { STYLES } from "@/lib/styles";
import { readEnvFile } from "../_target-guard.mjs";

const print = process.argv.includes("--print");
// readEnvFile is plain JS; its JSDoc return type (Record<string, string>) is
// what lets strict TS index it here — without it `next build` fails on this
// line, as every Vercel deploy from PR #62 to #71 did.
const file = readEnvFile();
const pick = (k: string) => (process.env[k] ?? file[k] ?? "").trim().replace(/^["']|["']$/g, "");
const A = { uri: pick("NEO4J_URI"), user: pick("NEO4J_USER"), password: pick("NEO4J_PASSWORD") };
const B = { uri: pick("KG_TARGET_URI"), user: pick("KG_TARGET_USER"), password: pick("KG_TARGET_PASSWORD") };
for (const [name, c] of [["NEO4J", A], ["KG_TARGET", B]] as const) {
  if (!c.uri || !c.user || !c.password) { console.error(`${name}_URI / _USER / _PASSWORD must be set`); process.exit(2); }
}
const host = (uri: string) => uri.replace(/^([a-z+]+:\/\/)(?:[^@/]*@)?/i, "$1");

const styleKeys = STYLES.map((s) => s.key);
const briefs = styleKeys.map((k) => ({ key: k, brief: resolveBrief({ styleKey: k, project: null }) }));
const unmapped = briefs.filter((b) => !b.brief).map((b) => b.key);
if (unmapped.length) console.log(`[kg-equiv] style keys with no KG brief (skipped, same as the app): ${unmapped.join(", ")}`);

async function runAll(c: { uri: string; user: string; password: string }) {
  process.env.NEO4J_URI = c.uri; process.env.NEO4J_USER = c.user; process.env.NEO4J_PASSWORD = c.password;
  await closeDriver();
  const out: Record<string, ContextBundle> = {};
  for (const b of briefs) if (b.brief) out[b.key] = await retrieveContextBundle(b.brief);
  await closeDriver();
  return out;
}

console.log(`[kg-equiv] A = ${host(A.uri)}`);
console.log(`[kg-equiv] B = ${host(B.uri)}`);
const ra = await runAll(A);
const rb = await runAll(B);

let contentDiff = 0, orderOnly = 0;
for (const b of briefs) {
  if (!b.brief) continue;
  const x = strip(ra[b.key]), y = strip(rb[b.key]);
  const exact = JSON.stringify(x) === JSON.stringify(y);
  const canon = JSON.stringify(canonical(x)) === JSON.stringify(canonical(y));
  const label = exact ? "IDENTICAL" : canon ? "identical up to tie order" : "DIFFERENT";
  if (!exact && canon) orderOnly++;
  if (!canon) contentDiff++;
  const a = ra[b.key];
  console.log(`  ${label.padEnd(26)} ${b.key.padEnd(22)} materials=${a.materials.length} spaces=${a.spaces.length} fixtures=${a.spaces.reduce((n, s) => n + s.fixtures.length, 0)} regs=${a.regulations.length} warnings=${a.warnings.length}`);
  if (!canon) {
    console.log("    --- A ---\n" + indent(formatBundleForPrompt(a)));
    console.log("    --- B ---\n" + indent(formatBundleForPrompt(rb[b.key])));
  } else if (print) {
    console.log("    --- A ---\n" + indent(formatBundleForPrompt(a)));
    console.log("    --- B ---\n" + indent(formatBundleForPrompt(rb[b.key])));
  }
}
console.log(`[kg-equiv] ${briefs.filter((b) => b.brief).length} briefs · content differences: ${contentDiff} · tie-order-only differences: ${orderOnly}`);
console.log(contentDiff ? "[kg-equiv] RESULT: NOT EQUIVALENT" : "[kg-equiv] RESULT: EQUIVALENT — the app would ground every prompt identically");
process.exit(contentDiff ? 1 : 0);

function strip(b: ContextBundle) { const { bundleId: _omit, ...rest } = b; void _omit; return rest; }
/** Order-insensitive view: sort ranked lists by (score desc, id), spaces by id. */
function canonical(b: Omit<ContextBundle, "bundleId">) {
  const byScoreId = <T extends { score: number; id: string }>(xs: T[]) => xs.slice().sort((p, q) => q.score - p.score || p.id.localeCompare(q.id));
  return {
    ...b,
    palettes: b.palettes.slice().sort((p, q) => p.id.localeCompare(q.id)),
    regulations: b.regulations.slice().sort((p, q) => p.id.localeCompare(q.id)),
    materials: byScoreId(b.materials),
    spaces: b.spaces.slice().sort((p, q) => p.id.localeCompare(q.id)).map((s) => ({ ...s, fixtures: byScoreId(s.fixtures) })),
    warnings: b.warnings.slice().sort(),
  };
}
function indent(s: string) { return s.split("\n").map((l) => "    " + l).join("\n"); }
