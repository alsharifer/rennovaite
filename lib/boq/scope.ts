// =============================================================================
// lib/boq/scope.ts — supply/install scope enforcement (ground-truth Step 2b).
//
// Prevents double-counting when actual rates carry different scopes:
//   - A `supply_and_install` line (joinery, aluminum — composite specialist
//     prices with NO labour section) must NEVER receive an added install line.
//   - A `supply_only` line (tiles, sanitary) must ALWAYS be paired with its
//     `install_only` labour counterpart, or be flagged `install_missing`.
// Pure + unit-tested. `install_only` lines are the labour-contract sections
// (Flooring Works for tiles, Sanitary & Plumbing for sanitary).
// =============================================================================

import type { Scope } from "@/lib/ground-truth/mudon-actuals";

export interface ScopedLine {
  description: string;
  scope: Scope;
  /** Groups a supply_only line with the install_only line that covers it. */
  install_group?: string | null;
  /** Set by enforcement when a supply_only line has no install counterpart. */
  install_missing?: boolean;
}

export interface ScopeViolation {
  kind: "composite_with_install" | "install_missing";
  description: string;
  detail: string;
}

/**
 * Validate + annotate a set of scoped lines against the two invariants. Returns
 * the (possibly `install_missing`-flagged) lines and any violations. A
 * `composite_with_install` violation means a supply_and_install line shares an
 * install_group with an install_only line — that install line is the
 * double-count and should not exist.
 */
export function enforceScope(lines: ScopedLine[]): {
  lines: ScopedLine[];
  violations: ScopeViolation[];
} {
  const violations: ScopeViolation[] = [];

  const installGroups = new Set(
    lines.filter((l) => l.scope === "install_only" && l.install_group).map((l) => l.install_group!),
  );
  const compositeGroups = new Set(
    lines.filter((l) => l.scope === "supply_and_install" && l.install_group).map((l) => l.install_group!),
  );

  const out = lines.map((l) => {
    // Rule 1: a supply_and_install composite must not be shadowed by an install line.
    if (l.scope === "supply_and_install" && l.install_group && installGroups.has(l.install_group)) {
      violations.push({
        kind: "composite_with_install",
        description: l.description,
        detail: `supply_and_install line shares install_group "${l.install_group}" with an install_only line — the install line double-counts.`,
      });
    }
    // Rule 2: a supply_only line must have an install_only counterpart, else flag.
    if (l.scope === "supply_only") {
      const paired = l.install_group != null && installGroups.has(l.install_group);
      if (!paired) {
        violations.push({
          kind: "install_missing",
          description: l.description,
          detail: `supply_only line has no install_only counterpart (install_group ${l.install_group ?? "unset"}).`,
        });
        return { ...l, install_missing: true };
      }
      return { ...l, install_missing: false };
    }
    return l;
  });

  // Silence the unused-set lint while keeping the intent explicit.
  void compositeGroups;
  return { lines: out, violations };
}

/** True if the scope set is clean (no double-counts, no orphaned supply lines). */
export function scopeIsValid(lines: ScopedLine[]): boolean {
  return enforceScope(lines).violations.length === 0;
}
