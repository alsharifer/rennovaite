// =============================================================================
// scripts/boq-dry-run-diff.ts — what would regenerating this BoQ change? (H3)
//
//   node --import ./scripts/_alias-hook.mjs scripts/boq-dry-run-diff.ts <project-id> [--boq <boq-id>] [--json <file>]
//
// READ-ONLY, against whichever database the environment names (production is
// allowed because nothing is written). Regenerates the project's BoQ
// IN-PROCESS under the current code — lib/boq/assemble.ts with dryRun, the
// same assembly the route runs — so no server, no session and no write is
// involved, then diffs it against a stored revision (default: the latest).
//
// Prints:
//   1. the summary chain old → new;
//   2. PRICE MOVEMENT, line by line (lib/boq/revision-diff.ts — the stable line
//      identity and classes the in-app revision diff uses): old/new quantity,
//      rate and total, with the facts that locate a cause (rule id, rate tier,
//      source label before/after);
//   3. every NON-PRICE field change, grouped by path: fields ADDED by newer
//      code (rate_tier, item_key, …), fields removed, and text/metadata that
//      changed.
// Descriptions are printed curated (lib/identity/curation.ts). Exit 0 always —
// this is a measurement, not a gate; the reader decides.
// =============================================================================

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { resolveTarget } from "./_target-guard.mjs";

import { assembleDeterministicBoq } from "../lib/boq/assemble.ts";
import { diffRevisions, snapshotRevision, type RevisionBoq } from "../lib/boq/revision-diff.ts";
import { curateText } from "../lib/identity/curation.ts";

const args = process.argv.slice(2);
const projectId = args.find((a) => /^[0-9a-f-]{36}$/.test(a));
const flag = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
if (!projectId) {
  console.error("usage: boq-dry-run-diff.ts <project-id> [--boq <boq-id>] [--json <file>]");
  process.exit(2);
}

const PRICE_KEYS = new Set(["quantity", "rate_aed", "total_aed", "section_total_aed", "subtotal_aed", "ohp_aed", "contingency_aed", "vat_aed", "grand_total_aed"]);
const aed = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

type Json = unknown;
interface FieldChange {
  kind: "added" | "removed" | "changed";
  /** Path segments; under sections: ["sections", <section>, "lines", <line>, field…]. */
  path: string[];
  old?: Json;
  new?: Json;
}

/** Walk two stored documents (sections and lines already keyed by bySection). */
function walk(a: Json, b: Json, at: string[], out: FieldChange[]) {
  if (a === undefined && b !== undefined) return void out.push({ kind: "added", path: at, new: b });
  if (a !== undefined && b === undefined) return void out.push({ kind: "removed", path: at, old: a });
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], [...at, "[]"], out);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) walk((a as Record<string, Json>)[k], (b as Record<string, Json>)[k], [...at, k], out);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ kind: "changed", path: at, old: a, new: b });
}

/** A group label: section and line names abstracted. */
function groupPath(p: string[]): string {
  const inLines = p[0] === "sections" && p[2] === "lines";
  return "$." + p.map((seg, i) => (p[0] === "sections" && i === 1 ? "<section>" : inLines && i === 3 ? "<line>" : seg)).join(".");
}

/**
 * Sections keyed by name and lines keyed by description (numbered on repeats),
 * so an inserted line does not shift every later one into a false "changed".
 * Description, not the price table's stable identity: a line whose identity
 * moved (a rule id added) must still meet its counterpart here.
 */
function bySection(doc: Record<string, Json>) {
  const secs = (doc.sections as { work_section: string; lines?: { description?: string }[] }[] | undefined) ?? [];
  return {
    ...doc,
    sections: Object.fromEntries(
      secs.map((s) => {
        const seen = new Map<string, number>();
        const lines = Object.fromEntries(
          (s.lines ?? []).map((l) => {
            const d = String(l.description ?? "");
            const n = (seen.get(d) ?? 0) + 1;
            seen.set(d, n);
            return [n === 1 ? d : `${d}#${n}`, l];
          }),
        );
        return [s.work_section, { ...s, lines }];
      }),
    ),
  };
}

async function main() {
  const { url, key, isProd } = resolveTarget({ script: "boq-dry-run-diff", writes: false });
  // The lib reads some inputs through the admin singleton (lib/supabase-admin),
  // which reads process.env — pin it to the SAME database this script resolved.
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const q = sb.from("boqs").select("id, created_at, total_aed, sections").eq("project_id", projectId!);
  const boqId = flag("--boq");
  const { data: stored, error } = await (boqId ? q.eq("id", boqId) : q.order("created_at", { ascending: false }).limit(1)).maybeSingle<{ id: string; created_at: string; total_aed: number; sections: Record<string, Json> }>();
  if (error || !stored) throw new Error(`stored BoQ not found: ${error?.message ?? "none"}`);

  // The assembly is best-effort by design (a missing table degrades to a
  // warning). A MEASUREMENT must not be: any degradation voids it.
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => {
    warnings.push(a.map(String).join(" "));
    warn(...a);
  };
  const result = await assembleDeterministicBoq(sb, projectId!, { dryRun: true });
  console.warn = warn;
  if (warnings.length) {
    console.error(`
MEASUREMENT VOID — the assembly degraded (${warnings.length} warning(s)); fix the environment and re-run.`);
    process.exit(1);
  }
  if (result.refusal) {
    console.log(`REFUSED ${result.refusal.status}: ${JSON.stringify(result.refusal.body)}`);
    return;
  }
  const fresh = JSON.parse(JSON.stringify(result.boq)) as Record<string, Json>;

  console.log(`\n${isProd ? "PRODUCTION" : "dev"} project ${projectId}`);
  console.log(`stored  ${stored.id}  ${stored.created_at}  engine ${JSON.stringify((stored.sections.engine as Record<string, Json> | undefined)?.version ?? null)}  total ${aed(stored.total_aed)}`);
  console.log(`dry run (current code)          engine ${JSON.stringify((fresh.engine as Record<string, Json> | undefined)?.version ?? null)}  total ${aed(fresh.grand_total_aed as number)}`);

  // 1 + 2. Price movement.
  const diff = diffRevisions(
    snapshotRevision(stored.id, stored.created_at, stored.sections as unknown as RevisionBoq),
    snapshotRevision("dry-run", new Date().toISOString(), fresh as unknown as RevisionBoq),
  );
  const s = diff.summary;
  console.log(`\nSUMMARY  subtotal ${aed(s.subtotal.old)} → ${aed(s.subtotal.new)} (${aed(s.subtotal.delta)})  ·  OH&P ${aed(s.ohp.old)} → ${aed(s.ohp.new)}  ·  contingency ${aed(s.contingency.old)} → ${aed(s.contingency.new)}  ·  VAT ${aed(s.vat.old)} → ${aed(s.vat.new)}  ·  TOTAL ${aed(s.grand.old)} → ${aed(s.grand.new)} (${aed(s.grand.delta)})`);
  console.log(`lines: ${diff.unchanged} unchanged · ${diff.counts.moved} moved · ${diff.counts.added} added · ${diff.counts.removed} removed`);

  const rawLine = (doc: Record<string, Json>, section: string, index: number | undefined) =>
    index === undefined ? null : ((doc.sections as { work_section: string; lines: Record<string, Json>[] }[]).find((x) => x.work_section === section)?.lines[index] ?? null);
  if (diff.lines.length) {
    console.log("\nPRICE MOVEMENT (line by line)");
    for (const l of diff.lines) {
      const o = rawLine(stored.sections, l.section, l.old?.index);
      const n = rawLine(fresh, l.section, l.new?.index);
      console.log(`  [${l.class}] ${l.section} · ${curateText(l.description)}`);
      console.log(`      qty ${l.old?.quantity ?? "-"} → ${l.new?.quantity ?? "-"} ${l.unit} · rate ${l.old ? aed(l.old.rate_aed) : "-"} → ${l.new ? aed(l.new.rate_aed) : "-"} · total ${l.old ? aed(l.old.total_aed) : "-"} → ${l.new ? aed(l.new.total_aed) : "-"} (Δ ${aed(l.delta_aed)})`);
      console.log(`      rule ${o?.rule_id ?? "-"} → ${n?.rule_id ?? "-"} · tier ${o?.rate_tier ?? "-"} → ${n?.rate_tier ?? "-"} · source "${curateText(String(o?.vendor_or_source ?? "-"))}" → "${curateText(String(n?.vendor_or_source ?? "-"))}"`);
    }
  }

  // 3. Non-price field changes.
  const changes: FieldChange[] = [];
  walk(bySection(stored.sections), bySection(fresh), [], changes);
  const nonPrice = changes.filter((c) => !PRICE_KEYS.has(c.path[c.path.length - 1]!));
  const groups = new Map<string, { kind: string; n: number; sample: FieldChange }>();
  for (const c of nonPrice) {
    const g = `${c.kind}  ${groupPath(c.path)}`;
    const cur = groups.get(g);
    if (cur) cur.n++;
    else groups.set(g, { kind: c.kind, n: 1, sample: c });
  }
  console.log(`\nNON-PRICE FIELD CHANGES (${nonPrice.length}, grouped by path)`);
  for (const [g, { n, sample }] of [...groups].sort()) {
    const show = (v: Json) => curateText(JSON.stringify(v) ?? "undefined").slice(0, 90);
    console.log(`  ${String(n).padStart(4)} × ${g}${sample.kind === "changed" ? `   e.g. ${show(sample.old)} → ${show(sample.new)}` : sample.kind === "added" ? `   e.g. ${show(sample.new)}` : `   e.g. ${show(sample.old)}`}`);
  }

  const jsonOut = flag("--json");
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ stored: { id: stored.id, created_at: stored.created_at }, summary: diff.summary, counts: diff.counts, lines: diff.lines, non_price: [...groups].map(([g, v]) => ({ group: g, n: v.n })) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
