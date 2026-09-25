// =============================================================================
// scripts/kg/import-graph.mjs — load a typed JSON export into the TARGET Neo4j
// (KG_TARGET_*), then re-read it and check the fingerprints match the file.
//
//   KG_TARGET_URI=neo4j+s://<id>.databases.neo4j.io KG_TARGET_USER=neo4j \
//   KG_TARGET_PASSWORD=... node scripts/kg/import-graph.mjs <export.json> [--replace]
//
// Refuses a non-empty target unless --replace is given, and --replace wipes it
// first (MATCH (n) DETACH DELETE n) — an import merged over stale content is
// neither the old graph nor the new one. Constraints and indexes are created
// before the data so the unique-id constraints reject a bad file rather than
// admit duplicates.
//
// Aura Free is the intended target: it supports the RANGE indexes and
// uniqueness constraints the seed uses (checked against `SHOW CONSTRAINTS` on
// the source), and the driver handles neo4j+s:// with no extra configuration.
// =============================================================================
import fs from "node:fs";
import { connect, verifyConnectivity, readGraph, summarize, fingerprints, decodeProps } from "./graph-io.mjs";

const file = process.argv[2];
const replace = process.argv.includes("--replace");
if (!file || !fs.existsSync(file)) {
  console.error("usage: node scripts/kg/import-graph.mjs <export.json> [--replace]");
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.format !== "rennovaite-kg-export/1") throw new Error(`unexpected file format ${data.format}`);

const { driver, label } = connect("target");
try {
  await verifyConnectivity(driver);
  const session = driver.session();
  try {
    const existing = (await session.run("MATCH (n) RETURN count(n) AS c")).records[0].get("c").toNumber();
    if (existing > 0 && !replace) {
      throw new Error(`${label} already holds ${existing} nodes — pass --replace to wipe it first`);
    }
    if (existing > 0) {
      console.log(`[kg-import] --replace: deleting ${existing} nodes on ${label}`);
      await session.run("MATCH (n) DETACH DELETE n");
    }

    // Schema first. Names are kept so SHOW CONSTRAINTS / SHOW INDEXES read the
    // same on both sides — verify-graph.mjs compares them by name.
    for (const c of data.constraints) {
      if (c.type !== "NODE_PROPERTY_UNIQUENESS") throw new Error(`constraint ${c.name}: type ${c.type} not handled`);
      await session.run(`CREATE CONSTRAINT ${ident(c.name)} IF NOT EXISTS FOR (n:${ident(c.labels[0])}) REQUIRE (${c.properties.map((p) => `n.${ident(p)}`).join(", ")}) IS UNIQUE`);
    }
    for (const i of data.indexes) {
      if (i.type !== "RANGE") throw new Error(`index ${i.name}: type ${i.type} not handled`);
      await session.run(`CREATE INDEX ${ident(i.name)} IF NOT EXISTS FOR (n:${ident(i.labels[0])}) ON (${i.properties.map((p) => `n.${ident(p)}`).join(", ")})`);
    }
    console.log(`[kg-import] schema: ${data.constraints.length} constraints, ${data.indexes.length} indexes`);

    // Nodes, grouped by label set so each batch is one CREATE with a literal
    // label (labels cannot be parameters).
    const byLabels = new Map();
    for (const n of data.nodes) {
      const key = n.labels.slice().sort().join(":");
      if (!byLabels.has(key)) byLabels.set(key, []);
      byLabels.get(key).push(decodeProps(n.props));
    }
    let nodeCount = 0;
    for (const [key, rows] of byLabels) {
      const labelExpr = key.split(":").map(ident).join(":");
      for (const batch of chunks(rows, 500)) {
        const res = await session.run(`UNWIND $rows AS row CREATE (n:${labelExpr}) SET n = row`, { rows: batch });
        nodeCount += res.summary.counters.updates().nodesCreated;
      }
    }
    console.log(`[kg-import] nodes created: ${nodeCount}`);

    // Relationships by type; endpoints matched on the seed's own `id`.
    const byType = new Map();
    for (const r of data.rels) {
      if (!byType.has(r.type)) byType.set(r.type, []);
      byType.get(r.type).push({ start: r.start, end: r.end, props: decodeProps(r.props) });
    }
    let relCount = 0;
    for (const [type, rows] of byType) {
      for (const batch of chunks(rows, 500)) {
        const res = await session.run(
          `UNWIND $rows AS row MATCH (a {id: row.start}), (b {id: row.end}) CREATE (a)-[r:${ident(type)}]->(b) SET r = row.props`,
          { rows: batch },
        );
        relCount += res.summary.counters.updates().relationshipsCreated;
      }
    }
    console.log(`[kg-import] relationships created: ${relCount}`);
    if (nodeCount !== data.nodes.length || relCount !== data.rels.length) {
      throw new Error(`created ${nodeCount}/${data.nodes.length} nodes and ${relCount}/${data.rels.length} relationships — an endpoint id in the file did not match`);
    }
  } finally {
    await session.close();
  }

  // Read it back and compare fingerprints with the file's.
  const graph = await readGraph(driver);
  const fp = fingerprints(graph);
  const crypto = process.getBuiltinModule("node:crypto");
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const nodesFp = sha(fp.nodes.join("\n"));
  const relsFp = sha(fp.rels.join("\n"));
  const s = summarize(graph);
  console.log(`[kg-import] read back: ${s.nodes} nodes / ${s.rels} relationships / ${s.constraints} constraints / ${s.indexes} indexes`);
  if (nodesFp !== data.fingerprint.nodes || relsFp !== data.fingerprint.rels) {
    throw new Error(`fingerprint mismatch after import (nodes ${nodesFp === data.fingerprint.nodes ? "ok" : "DIFFER"}, rels ${relsFp === data.fingerprint.rels ? "ok" : "DIFFER"})`);
  }
  console.log(`[kg-import] fingerprints match the export file — ${label} holds the same graph`);
} finally {
  await driver.close();
}

function ident(s) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier ${s}`);
  return "`" + s + "`";
}
function* chunks(arr, n) { for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n); }
