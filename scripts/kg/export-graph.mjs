// =============================================================================
// scripts/kg/export-graph.mjs — dump the CURRENT Neo4j (NEO4J_*) to a typed
// JSON file, without stopping the database.
//
//   node scripts/kg/export-graph.mjs [out.json]
//
// Default output: %USERPROFILE%\backups\rennovaite\kg\kg-<stamp>.json — OUTSIDE
// the repo. The file is the seed content of the KG (materials, vendors,
// prices); it is not committed.
//
// Why not `neo4j-admin database dump`? That needs the database offline, which
// on this container means stopping it — downtime for the app for the sake of a
// migration whose whole point is removing downtime. The driver export reads a
// live database, and the fingerprint check in verify-graph.mjs proves it lost
// nothing. (A .dump can still be produced for Aura's console import if ever
// wanted; docs/OPS_RUNBOOK.md says how.)
// =============================================================================
import path from "node:path";
import crypto from "node:crypto";
import { connect, verifyConnectivity, readGraph, summarize, fingerprints, encodeProps, defaultDumpDir, writeJson } from "./graph-io.mjs";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
const out = process.argv[2] ?? path.join(defaultDumpDir(), `kg-${stamp}.json`);

const { driver, label } = connect("current");
try {
  await verifyConnectivity(driver);
  console.log(`[kg-export] reading ${label}`);
  const graph = await readGraph(driver);
  const summary = summarize(graph);
  const fp = fingerprints(graph);
  const file = {
    format: "rennovaite-kg-export/1",
    exported_at: new Date().toISOString(),
    source: label,
    summary,
    fingerprint: { nodes: sha(fp.nodes.join("\n")), rels: sha(fp.rels.join("\n")) },
    constraints: graph.constraints,
    indexes: graph.indexes,
    nodes: graph.nodes.map((n) => ({ labels: n.labels, props: encodeProps(n.props) })),
    rels: graph.rels.map((r) => ({ type: r.type, start: r.start, end: r.end, props: encodeProps(r.props) })),
  };
  writeJson(out, file);
  console.log(`[kg-export] ${summary.nodes} nodes / ${summary.rels} relationships / ${summary.constraints} constraints / ${summary.indexes} indexes`);
  console.log(`[kg-export] labels: ${Object.entries(summary.byLabel).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`[kg-export] fingerprint nodes=${file.fingerprint.nodes.slice(0, 12)} rels=${file.fingerprint.rels.slice(0, 12)}`);
  console.log(`[kg-export] wrote ${out}`);
} finally {
  await driver.close();
}

function sha(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
