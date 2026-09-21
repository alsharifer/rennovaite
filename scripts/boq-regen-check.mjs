#!/usr/bin/env node
// =============================================================================
// scripts/boq-regen-check.mjs — prove a pricing change is byte-identical (T1.0).
//
// Regenerates a project's BoQ through the REAL route with `dry_run: true`, so
// nothing is written: no boqs row, no takeoff_items, no pilot event. The result
// is the exact document a real run would store.
//
//   node scripts/boq-regen-check.mjs capture <dir> [port] <project-id>...
//   node scripts/boq-regen-check.mjs diff <dirA> <dirB> [--allow-additive=field,...]
//
// `diff` compares every project captured in both directions. `engine.generated_at`
// is the one field that legitimately differs between two runs. With
// --allow-additive, a field present ONLY on the B side (a new, additive line
// field such as `rate_tier`) is reported but not counted as a difference; any
// changed or removed value still fails.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

const [cmd, ...args] = process.argv.slice(2);

async function capture(dir, port, ids) {
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ids) {
    const res = await fetch(`http://localhost:${port}/api/generate-boq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: id, dry_run: true }),
    });
    const body = await res.json();
    if (!res.ok || !body.dry_run) {
      console.error(`${id}: ${res.status} ${body.error ?? JSON.stringify(body).slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(body.boq, null, 2));
    console.log(`${id}: grand_total_aed ${body.boq.grand_total_aed} · ${body.boq.sections.length} sections · ${body.boq.sections.reduce((n, s) => n + s.lines.length, 0)} lines`);
  }
}

function walk(a, b, at, out, allow) {
  if (at === "$.engine.generated_at") return;
  if (a === undefined && b !== undefined) {
    const field = at.split(".").pop();
    (allow.has(field) ? out.additive : out.diffs).push(`${at}: <absent> → ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      out.diffs.push(`${at}: array length ${a?.length} → ${b?.length}`);
      return;
    }
    a.forEach((x, i) => walk(x, b[i], `${at}[${i}]`, out, allow));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${at}.${k}`, out, allow);
    return;
  }
  if (a !== b) out.diffs.push(`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}

function diff(dirA, dirB, allow) {
  let failed = false;
  const files = fs.readdirSync(dirA).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const pb = path.join(dirB, f);
    if (!fs.existsSync(pb)) { console.log(`${f}: missing on B side`); failed = true; continue; }
    const a = JSON.parse(fs.readFileSync(path.join(dirA, f), "utf8"));
    const b = JSON.parse(fs.readFileSync(pb, "utf8"));
    const out = { diffs: [], additive: [] };
    walk(a, b, "$", out, allow);
    const totals = `grand_total ${a.grand_total_aed} → ${b.grand_total_aed}`;
    if (out.diffs.length === 0) {
      console.log(`${f}: IDENTICAL (${totals})${out.additive.length ? ` · ${out.additive.length} additive field(s): ${[...new Set(out.additive.map((d) => d.split(":")[0].replace(/\[\d+\]/g, "[]")))].join(", ")}` : ""}`);
    } else {
      failed = true;
      console.log(`${f}: ${out.diffs.length} DIFFERENCE(S) (${totals})`);
      for (const d of out.diffs.slice(0, 25)) console.log(`   ${d}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (cmd === "capture") {
  const [dir, maybePort, ...rest] = args;
  const port = /^\d+$/.test(maybePort) ? maybePort : "3098";
  const ids = /^\d+$/.test(maybePort) ? rest : [maybePort, ...rest];
  await capture(dir, port, ids);
} else if (cmd === "diff") {
  const allowArg = args.find((a) => a.startsWith("--allow-additive="));
  const allow = new Set(allowArg ? allowArg.split("=")[1].split(",") : []);
  const [dirA, dirB] = args.filter((a) => !a.startsWith("--"));
  diff(dirA, dirB, allow);
} else {
  console.error("usage: capture <dir> [port] <id>... | diff <dirA> <dirB> [--allow-additive=a,b]");
  process.exit(2);
}
