// =============================================================================
// scripts/boq-invariants-check.ts — the D4 and D5 invariants on every LIVE BoQ.
//
//   node --import ./scripts/_alias-hook.mjs scripts/boq-invariants-check.ts [port]
//
// READ-ONLY. For each project's latest stored BoQ:
//   D5 — one REF per line, unique within the BoQ, and the /boq-refs route agrees;
//   D4 — the headline excludes exactly the QS-to-price lines, says so in words,
//        and excluding them moves no money (they are worth 0).
// The unit tests pin the rules; this pins the BoQs that actually exist.
// =============================================================================
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assignRefs } from "@/lib/boq/refs";
import { formatAed } from "@/lib/format/aed";
import { boqDerivedInfo, derivedTotal, isUnpricedLine } from "@/lib/documents/boq-derived";

const ROOT = "C:/dev/rennovaite";
const PORT = process.argv[2] ?? "3098";
for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
}
const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

const round = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => formatAed(n, "aed");

const { data: projects } = await db.from("projects").select("id, name").order("created_at", { ascending: false });
for (const p of (projects ?? []) as { id: string; name: string }[]) {
  const { data: boq } = await db
    .from("boqs")
    .select("id, sections")
    .eq("project_id", p.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; sections: { grand_total_aed: number; sections: { work_section: string; lines: Record<string, unknown>[] }[] } }>();
  if (!boq) {
    console.log(`\n${p.name}: no BoQ`);
    continue;
  }
  const sections = boq.sections.sections;
  const lines = sections.flatMap((s) => s.lines);
  console.log(`\n${p.name} (${p.id.slice(0, 8)}) — ${lines.length} lines, AED ${boq.sections.grand_total_aed}`);

  // --- D5: one unique REF per line, on screen and from the route ------------------
  const refs = assignRefs(sections);
  const values = Object.values(refs);
  check("D5 one REF per line, all unique", values.length === lines.length && new Set(values).size === values.length, `${new Set(values).size}/${lines.length}`);
  const route = (await (await fetch(`http://localhost:${PORT}/api/projects/${p.id}/boq-refs`)).json()) as { rows?: { ref: string }[]; error?: string };
  const routeRefs = (route.rows ?? []).map((r) => r.ref);
  check("D5 the REF route agrees with the page and is unique", routeRefs.length === values.length && new Set(routeRefs).size === routeRefs.length && routeRefs.every((r) => values.includes(r)), route.error ?? `${routeRefs.length} rows`);

  // --- D4: the headline excludes exactly the unpriced lines, and the split adds up --
  const info = boqDerivedInfo(boq.sections as never);
  const total = derivedTotal(boq.sections.grand_total_aed, info);
  const unpriced = lines.filter((l) => isUnpricedLine(l as never));
  check("D4 the headline excludes exactly the QS-to-price lines", (total.excluded?.length ?? 0) === unpriced.length, `${total.excluded?.length ?? 0} excluded / ${unpriced.length} unpriced`);
  if (unpriced.length) {
    check("D4 the headline says so in words", /excludes \d+ line/.test(total.headline), total.headline);
    check("D4 every excluded line carries a rate of 0", unpriced.every((l) => Number(l.rate_aed) === 0 && Number(l.total_aed) === 0));
    const excludedValue = round(unpriced.reduce((sum, l) => sum + Number(l.total_aed ?? 0), 0));
    check("D4 excluding them moves no money (they are worth 0)", excludedValue === 0, `AED ${excludedValue}`);
    // The printed figure is still the stored total: ≈ rounded to 100 on a draft, exact otherwise.
    const printed = total.derived ? `≈ ${fmt(Math.round(boq.sections.grand_total_aed / 100) * 100)}*` : fmt(boq.sections.grand_total_aed);
    check("D4 the headline still prints the stored total", total.text === printed, `${total.text} vs ${printed}`);
  } else {
    check("D4 nothing to exclude → a plain headline", !/excludes/.test(total.headline), total.headline);
  }
}

console.log(`\n${failed === 0 ? "ALL GREEN" : `${failed} FAILED`}`);
process.exit(failed ? 1 : 0);
