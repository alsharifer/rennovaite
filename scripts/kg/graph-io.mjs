// =============================================================================
// scripts/kg/graph-io.mjs — shared I/O for moving the KG between Neo4j instances.
//
// Two instances are named by environment prefix, never by argument:
//
//   NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD           the CURRENT instance (what
//                                                     the app reads today; the
//                                                     same variables the app uses)
//   KG_TARGET_URI / KG_TARGET_USER / KG_TARGET_PASSWORD
//                                                     the CANDIDATE instance
//
// Both come from the process environment first and `.env.local` second, so an
// Aura URI can be supplied inline for one command and never written anywhere:
//
//   KG_TARGET_URI=neo4j+s://xxxx.databases.neo4j.io KG_TARGET_USER=neo4j \
//   KG_TARGET_PASSWORD=... node scripts/kg/import-graph.mjs <file>
//
// Credentials are never printed: `describe()` shows scheme + host only.
//
// Encoding. Neo4j values are written to JSON with explicit type tags because
// JSON alone cannot tell a FLOAT 1.0 from an INTEGER 1, or a ZONED DATETIME
// from a string. The tag set covers exactly the types the seed uses (verified
// with valueType() on 2026-09-25: STRING, FLOAT, BOOLEAN, ZONED DATETIME,
// LIST<STRING|FLOAT|NOTHING>) plus INTEGER for safety. Anything else throws —
// a silent coercion would be a lossy migration that reads as a clean one.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import neo4j from "neo4j-driver";
import { readEnvFile } from "../_target-guard.mjs";

const { DateTime, Integer } = neo4j.types;

function envOf(prefix) {
  const file = readEnvFile();
  const get = (k) => {
    const v = process.env[`${prefix}_${k}`] ?? file[`${prefix}_${k}`];
    return v == null ? undefined : String(v).trim().replace(/^["']|["']$/g, "");
  };
  return { uri: get("URI"), user: get("USER"), password: get("PASSWORD") };
}

/** Scheme + host only — safe to print. */
export function describe(uri) {
  if (!uri) return "(unset)";
  const m = /^([a-z+]+):\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(uri);
  return m ? `${m[1]}://${m[2]}` : "(unparseable uri)";
}

/**
 * Open a driver for a named instance. `which` is "current" (NEO4J_*) or
 * "target" (KG_TARGET_*). Throws when the URI is missing rather than falling
 * back to localhost — a migration script that quietly talks to the wrong
 * database is the failure this whole exercise exists to remove.
 */
export function connect(which) {
  const prefix = which === "target" ? "KG_TARGET" : "NEO4J";
  const { uri, user, password } = envOf(prefix);
  if (!uri || !user || password == null) {
    throw new Error(`${prefix}_URI / ${prefix}_USER / ${prefix}_PASSWORD must all be set (${which} instance)`);
  }
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return { driver, label: `${which} ${describe(uri)}` };
}

export async function verifyConnectivity(driver) {
  await driver.verifyConnectivity();
}

// ---------- value encoding ----------

export function encodeValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return { t: "s", v };
  if (typeof v === "boolean") return { t: "b", v };
  if (typeof v === "number") return { t: "f", v };
  if (Integer.isInteger(v) || v instanceof Integer) return { t: "i", v: v.toString() };
  if (v instanceof DateTime) {
    return {
      t: "dt",
      v: {
        year: num(v.year), month: num(v.month), day: num(v.day),
        hour: num(v.hour), minute: num(v.minute), second: num(v.second),
        nanosecond: num(v.nanosecond),
        offset: v.timeZoneOffsetSeconds == null ? null : num(v.timeZoneOffsetSeconds),
        zone: v.timeZoneId ?? null,
      },
    };
  }
  if (Array.isArray(v)) return { t: "l", v: v.map(encodeValue) };
  throw new Error(`unsupported property type: ${Object.prototype.toString.call(v)} (${JSON.stringify(v).slice(0, 80)})`);
}

export function decodeValue(e) {
  if (e === null || e === undefined) return null;
  switch (e.t) {
    case "s": return String(e.v);
    case "b": return Boolean(e.v);
    case "f": return Number(e.v); // the JS driver sends a JS number as FLOAT
    case "i": return neo4j.int(e.v);
    case "dt": {
      const d = e.v;
      return new DateTime(d.year, d.month, d.day, d.hour, d.minute, d.second, d.nanosecond, d.offset ?? undefined, d.zone ?? undefined);
    }
    case "l": return e.v.map(decodeValue);
    default: throw new Error(`unknown tag ${e.t}`);
  }
}

function num(x) { return Integer.isInteger(x) ? x.toNumber() : Number(x); }

export function encodeProps(props) {
  const out = {};
  for (const k of Object.keys(props).sort()) out[k] = encodeValue(props[k]);
  return out;
}
export function decodeProps(enc) {
  const out = {};
  for (const k of Object.keys(enc)) out[k] = decodeValue(enc[k]);
  return out;
}

// ---------- canonical fingerprints ----------
// A node is identified by (label, id); a relationship by (type, start id,
// end id). The fingerprint hashes the encoded, key-sorted properties, so two
// graphs are identical iff their fingerprint multisets are — independent of
// internal element ids, which never survive a migration.

export function nodeFingerprint(labels, props) {
  return sha(JSON.stringify([labels.slice().sort(), encodeProps(props)]));
}
export function relFingerprint(type, startId, endId, props) {
  return sha(JSON.stringify([type, startId, endId, encodeProps(props)]));
}
function sha(s) { return crypto.createHash("sha256").update(s).digest("hex"); }

// ---------- reading a whole graph ----------

export async function readGraph(driver) {
  const session = driver.session();
  try {
    const nodesRes = await session.run("MATCH (n) RETURN labels(n) AS labels, properties(n) AS props ORDER BY n.id");
    const nodes = nodesRes.records.map((r) => ({ labels: r.get("labels"), props: r.get("props") }));
    const relsRes = await session.run(
      "MATCH (a)-[r]->(b) RETURN type(r) AS type, a.id AS start, b.id AS end, properties(r) AS props ORDER BY type(r), a.id, b.id",
    );
    const rels = relsRes.records.map((r) => ({ type: r.get("type"), start: r.get("start"), end: r.get("end"), props: r.get("props") }));
    const cons = await session.run("SHOW CONSTRAINTS YIELD name, type, labelsOrTypes, properties RETURN name, type, labelsOrTypes, properties ORDER BY name");
    const constraints = cons.records.map((r) => ({ name: r.get("name"), type: r.get("type"), labels: r.get("labelsOrTypes"), properties: r.get("properties") }));
    const idx = await session.run(
      "SHOW INDEXES YIELD name, type, labelsOrTypes, properties, owningConstraint WHERE type <> 'LOOKUP' AND owningConstraint IS NULL RETURN name, type, labelsOrTypes, properties ORDER BY name",
    );
    const indexes = idx.records.map((r) => ({ name: r.get("name"), type: r.get("type"), labels: r.get("labelsOrTypes"), properties: r.get("properties") }));
    return { nodes, rels, constraints, indexes };
  } finally {
    await session.close();
  }
}

export function summarize(graph) {
  const byLabel = {};
  for (const n of graph.nodes) for (const l of n.labels) byLabel[l] = (byLabel[l] ?? 0) + 1;
  const byType = {};
  for (const r of graph.rels) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return {
    nodes: graph.nodes.length,
    rels: graph.rels.length,
    byLabel: sortObj(byLabel),
    byType: sortObj(byType),
    constraints: graph.constraints.length,
    indexes: graph.indexes.length,
  };
}
function sortObj(o) { return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])); }

export function fingerprints(graph) {
  const nodes = graph.nodes.map((n) => nodeFingerprint(n.labels, n.props)).sort();
  const rels = graph.rels.map((r) => relFingerprint(r.type, r.start, r.end, r.props)).sort();
  return { nodes, rels };
}

export function multisetDiff(a, b) {
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  const onlyA = [], onlyB = [];
  for (const [k, v] of ca) { const d = v - (cb.get(k) ?? 0); if (d > 0) onlyA.push([k, d]); }
  for (const [k, v] of cb) { const d = v - (ca.get(k) ?? 0); if (d > 0) onlyB.push([k, d]); }
  return { onlyA, onlyB };
}

export function defaultDumpDir() {
  return path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "backups", "rennovaite", "kg");
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1));
}
