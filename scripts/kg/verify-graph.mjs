// =============================================================================
// scripts/kg/verify-graph.mjs — prove two live Neo4j instances hold the same
// graph: CURRENT (NEO4J_*) against TARGET (KG_TARGET_*).
//
//   KG_TARGET_URI=... KG_TARGET_USER=... KG_TARGET_PASSWORD=... \
//   node scripts/kg/verify-graph.mjs
//
// Compares, in order: node count · relationship count · per-label counts ·
// per-type counts · constraints (name, type, label, properties) · non-lookup
// indexes · and finally the multiset of node and relationship fingerprints
// (label + every property, typed). Exits 1 on the first difference and names
// it. Internal element ids are deliberately not compared — they never survive
// a migration and mean nothing to the app, which addresses everything by `id`.
// =============================================================================
import { connect, verifyConnectivity, readGraph, summarize, fingerprints, multisetDiff, nodeFingerprint } from "./graph-io.mjs";

const a = connect("current");
const b = connect("target");
let failed = false;
try {
  await verifyConnectivity(a.driver);
  await verifyConnectivity(b.driver);
  const [ga, gb] = await Promise.all([readGraph(a.driver), readGraph(b.driver)]);
  const sa = summarize(ga), sb = summarize(gb);
  console.log(`[kg-verify] A = ${a.label}`);
  console.log(`[kg-verify] B = ${b.label}`);

  check("node count", sa.nodes, sb.nodes);
  check("relationship count", sa.rels, sb.rels);
  checkMap("nodes by label", sa.byLabel, sb.byLabel);
  checkMap("relationships by type", sa.byType, sb.byType);
  checkList("constraints", ga.constraints.map(schemaKey), gb.constraints.map(schemaKey));
  checkList("indexes (non-lookup, non-constraint)", ga.indexes.map(schemaKey), gb.indexes.map(schemaKey));

  const fa = fingerprints(ga), fb = fingerprints(gb);
  const dn = multisetDiff(fa.nodes, fb.nodes);
  const dr = multisetDiff(fa.rels, fb.rels);
  row("node fingerprints", `${fa.nodes.length} vs ${fb.nodes.length}`, dn.onlyA.length === 0 && dn.onlyB.length === 0);
  row("relationship fingerprints", `${fa.rels.length} vs ${fb.rels.length}`, dr.onlyA.length === 0 && dr.onlyB.length === 0);
  if (dn.onlyA.length || dn.onlyB.length) explain("nodes", ga, gb, dn);
  if (dr.onlyA.length || dr.onlyB.length) console.log(`  relationships only in A: ${dr.onlyA.length}, only in B: ${dr.onlyB.length}`);

  console.log(failed ? "[kg-verify] RESULT: DIFFERENT" : "[kg-verify] RESULT: IDENTICAL — every node, relationship, property, constraint and index matches");
} finally {
  await a.driver.close();
  await b.driver.close();
}
process.exit(failed ? 1 : 0);

function schemaKey(s) { return `${s.name}:${s.type}:${(s.labels ?? []).join("|")}:${(s.properties ?? []).join(",")}`; }
function row(name, detail, ok) { console.log(`  ${ok ? "OK  " : "DIFF"} ${name.padEnd(42)} ${detail}`); if (!ok) failed = true; }
function check(name, x, y) { row(name, `${x} vs ${y}`, x === y); }
function checkMap(name, x, y) {
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
  const bad = keys.filter((k) => x[k] !== y[k]);
  row(name, bad.length ? bad.map((k) => `${k}: ${x[k] ?? 0} vs ${y[k] ?? 0}`).join(", ") : `${keys.length} keys equal`, bad.length === 0);
}
function checkList(name, x, y) {
  const sx = new Set(x), sy = new Set(y);
  const onlyX = x.filter((k) => !sy.has(k)), onlyY = y.filter((k) => !sx.has(k));
  row(name, onlyX.length || onlyY.length ? `only A: [${onlyX}] only B: [${onlyY}]` : `${x.length} equal`, onlyX.length === 0 && onlyY.length === 0);
}
function explain(kind, ga, gb, d) {
  // Name the ids behind differing fingerprints so a diff is actionable.
  const idsA = new Map(ga.nodes.map((n) => [fpOf(n), n.props.id]));
  const idsB = new Map(gb.nodes.map((n) => [fpOf(n), n.props.id]));
  console.log(`  ${kind} only in A: ${d.onlyA.slice(0, 10).map(([k]) => idsA.get(k)).join(", ")}${d.onlyA.length > 10 ? " …" : ""}`);
  console.log(`  ${kind} only in B: ${d.onlyB.slice(0, 10).map(([k]) => idsB.get(k)).join(", ")}${d.onlyB.length > 10 ? " …" : ""}`);
}
function fpOf(n) { return nodeFingerprint(n.labels, n.props); }
