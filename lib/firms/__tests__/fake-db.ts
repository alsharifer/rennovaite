// =============================================================================
// An in-memory stand-in for the Supabase query builder — just enough of it for
// lib/firms/store.ts and lib/rates/firm.ts, with the constraints migration 041
// declares (unique firm name, one book per firm, one entry per
// firm/key/grade/origin). Filters are applied exactly as written, so a query
// that forgets `.eq("firm_id", …)` returns other firms' rows here too — which is
// the point: the isolation tests would catch it.
//
// `ignoreFilters` simulates a broken upstream query for the defence-in-depth
// test (the overlay must still refuse foreign rows).
// =============================================================================

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Err = { message: string; code?: string } | null;

export interface FakeDb {
  tables: Record<string, Row[]>;
  client: SupabaseClient;
  ignoreFilters: Set<string>;
}

const UNIQUE: Record<string, (r: Row) => string> = {
  firms: (r) => String(r.name).trim().toLowerCase(),
  firm_rate_books: (r) => String(r.firm_id),
  firm_rate_entries: (r) => `${r.firm_id}|${r.item_key}|${r.grade ?? "*"}|${r.origin}`,
};

const DEFAULTS: Record<string, (r: Row) => Row> = {
  firms: (r) => ({ private: true, created_by: null, created_at: new Date().toISOString(), ...r }),
  firm_rate_books: (r) => ({ ohp_pct: 0, ...r }),
  firm_rate_entries: (r) => ({ grade: null, origin: "firm_entry", correction_id: null, note: null, ...r }),
};

class Query implements PromiseLike<{ data: unknown; error: Err; count?: number | null }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private payload: Row[] | Row | null = null;
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";
  private head = false;
  private count = false;
  private orderBy: string | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.head = !!opts?.head;
      this.count = opts?.count === "exact";
    } else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  like(col: string, pattern: string) {
    const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
    this.filters.push((r) => re.test(String(r[col])));
    return this;
  }
  order(col: string) {
    this.orderBy = col;
    return this;
  }
  returns() {
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }

  private match(r: Row): boolean {
    if (this.db.ignoreFilters.has(this.table)) return true;
    return this.filters.every((f) => f(r));
  }

  private exec(): { data: unknown; error: Err; count?: number | null } {
    const table = this.rows();
    let out: Row[] = [];
    if (this.op === "select") {
      out = table.filter((r) => this.match(r));
      if (this.orderBy) {
        const k = this.orderBy;
        out = out.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      }
      if (this.head) return { data: null, error: null, count: this.count ? out.length : null };
    } else if (this.op === "insert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => ({
        id: randomUUID(),
        ...(DEFAULTS[this.table]?.(r as Row) ?? r),
      }));
      const key = UNIQUE[this.table];
      if (key) {
        const seen = new Set(table.map(key));
        for (const r of incoming) {
          if (seen.has(key(r))) return { data: null, error: { message: "duplicate key value", code: "23505" } };
          seen.add(key(r));
        }
      }
      table.push(...incoming);
      out = incoming;
    } else if (this.op === "update") {
      out = table.filter((r) => this.match(r));
      for (const r of out) Object.assign(r, this.payload);
    } else {
      out = table.filter((r) => this.match(r));
      this.db.tables[this.table] = table.filter((r) => !out.includes(r));
    }
    const copy = out.map((r) => ({ ...r }));
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    if (this.mode === "single") {
      return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: `expected 1 row, got ${copy.length}`, code: "PGRST116" } };
    }
    if (this.mode === "maybe") {
      return copy.length <= 1 ? { data: copy[0] ?? null, error: null } : { data: null, error: { message: "multiple rows", code: "PGRST116" } };
    }
    return { data: copy, error: null };
  }

  then<A, B>(onfulfilled?: ((v: { data: unknown; error: Err; count?: number | null }) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}

export function fakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: JSON.parse(JSON.stringify(seed)),
    ignoreFilters: new Set(),
    client: null as unknown as SupabaseClient,
  };
  db.client = { from: (t: string) => new Query(db, t) } as unknown as SupabaseClient;
  return db;
}
