// =============================================================================
// lib/boq/line-identity.ts — the STABLE identity of a BoQ line (U4 / L3).
//
// Two revisions of one project's BoQ are compared line by line, so each line
// needs a key that survives regeneration. The keys the documents already carry
// do not:
//
//   REF codes    are positional ("HRD-03" is the third line of a section — insert
//                a line above it and every code below moves);
//   rule_id      is stable for garden (GL-04), overlay (P2/overlay/<type>) and
//                element (P4/quantify/<key>) lines, but the interior engine
//                appends the resolved rate's note prefix ("R-12/Catalogue: …"),
//                so a line whose RATE changed tier changed its key too — and the
//                old change report read that as one line removed and another
//                added.
//
// The identity is, in order: the line's own `item_key` (written on every engine
// and garden line since U4); the rate-book item the rule id or description names
// (`lineItemKey`, the same map the provenance popover uses, so a BoQ stored
// before U4 keys exactly like one stored after); the rule id with the engine's
// volatile suffix removed; the description. Repeats within a section are
// numbered in order of appearance (`#2`, `#3`), so two identical lines diff
// against each other by position.
//
// Pure. Imports only vocabularies (rules, the landscape labels).
// =============================================================================

import { UNPRICED_GARDEN_ITEMS } from "@/lib/boq/garden-takeoff";
import { RATE_RULES } from "@/lib/boq/rules";
import { GARDEN_RATES } from "@/lib/ground-truth/villa94-garden";

export interface IdentityLine {
  description: string;
  rule_id?: string;
  item_key?: string;
}

const RULE_ITEM = new Map<string, string>(Object.entries(RATE_RULES).map(([k, r]) => [r.rule_id, k]));
const GARDEN_LABEL_ITEM = new Map<string, string>([
  ...GARDEN_RATES.map((g) => [g.label, g.item_key] as const),
  ...Object.entries(UNPRICED_GARDEN_ITEMS).map(([k, v]) => [v.label, k] as const),
]);

/** The rate-book item key behind a stored line, when one can be named. */
export function lineItemKey(line: IdentityLine): string | null {
  if (line.item_key) return line.item_key;
  const rule = line.rule_id ?? "";
  const r = rule.split("/").find((p) => /^R-\d+/.test(p));
  if (r && RULE_ITEM.has(r)) return RULE_ITEM.get(r)!;
  if (rule.startsWith("GL-")) return GARDEN_LABEL_ITEM.get(line.description) ?? null;
  if (rule.startsWith("P4/quantify/")) return rule.slice("P4/quantify/".length);
  return null;
}

/** The engine's rule id without its volatile rate-note suffix ("R-12/Catalogue" → "R-12"). */
export function stableRuleId(ruleId: string | undefined): string | null {
  if (!ruleId) return null;
  const m = /^(R-\d+[a-z]?)\//.exec(ruleId);
  return m ? m[1]! : ruleId;
}

/** The identity of one line, before repeat numbering. */
export function lineIdentity(line: IdentityLine): string {
  return lineItemKey(line) ?? stableRuleId(line.rule_id) ?? line.description;
}

/**
 * Stable keys for every line of a BoQ, keyed `${work_section}-${idx}` (the
 * BoQ view's row key), valued `${work_section}|${identity}[#n]`.
 */
export function stableLineKeys(sections: readonly { work_section: string; lines: readonly IdentityLine[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sections) {
    const seen = new Map<string, number>();
    s.lines.forEach((l, idx) => {
      const base = `${s.work_section}|${lineIdentity(l)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out[`${s.work_section}-${idx}`] = n === 1 ? base : `${base}#${n}`;
    });
  }
  return out;
}
