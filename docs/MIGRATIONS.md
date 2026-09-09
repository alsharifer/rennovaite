# Migrations

**`supabase db push` is the only supported way to change the schema.** Pasting
SQL into the Supabase dashboard is no longer how this project works, and every
instruction that said otherwise has been marked obsolete.

## Why this changed

Thirty migrations were applied by hand. It worked, and it left no record of what
had actually run, so the only way to answer "is production up to date?" was to
probe the live database column by column. Doing exactly that on 2026-09-09 found
**029 had never been applied** while 030 had — the schema was not behind, it was
*out of order*, and nobody could have known from the repo.

A ledger is the fix. The CLI keeps one; this repo adds a second guard the CLI
cannot provide.

## Adding a migration

```bash
npx supabase migration new descriptive_name
```

Write the SQL in the file it creates, then:

```bash
node scripts/update-migration-manifest.mjs
```

That records the file's checksum. Commit both.

## Applying

```bash
npx supabase link --project-ref <ref>     # once per machine, per project
npx supabase db push                       # applies anything not yet run
npx supabase migration list                # local vs remote, side by side
```

`db push` applies only versions the target has not seen. Running it twice is a
no-op — the ledger lives in `supabase_migrations.schema_migrations` on the
database itself.

## The two guards, and what each is for

**The CLI ledger** stops a migration running twice. It cannot see a file being
*edited* after it ran: the version is unchanged, so every database that already
applied it keeps the old statements while the repo shows new ones. The two drift
apart silently and permanently.

**`supabase/migrations.manifest.json`** closes that. It holds a sha256 per
migration; `scripts/check-migrations.mjs` fails if any tracked file changes or
disappears, and `lib/__tests__/migrations.test.ts` runs it with the suite.

> **A migration that has run anywhere can never be edited.** Supersede it with a
> new one. This is not a style preference — an edited migration means two
> databases that both report "up to date" while holding different schemas.

## Verified from zero

A scratch Postgres 16 container, all 30 migrations applied in order from an
empty database, then its schema compared column-by-column against production:

```
shadow: 29 tables, 257 columns — 30/30 applied, 0 failures

tables in shadow, absent in production : none
columns in shadow, absent in production: plans.has_overlaps,
                                         plans.overlap_pairs,
                                         plans.overlaps_checked_at
```

Those three are migration **029**, which production has never had applied. The
diff is the outstanding migration and nothing else — a fresh database built from
this directory reaches production's schema exactly.

One limit worth stating: PostgREST cannot enumerate a schema, so the *other*
direction — objects in production that no migration creates — is not testable
from here. It needs `pg_dump --schema-only`, which needs the database password
(see I9). Anything created ad hoc in the dashboard over the past thirty
migrations would be invisible to this check.

## The historical files

`scripts/migrations/001…030.sql` are **frozen**. They are the record of what was
applied by hand and are not read by any tool. Do not edit them, do not add to
them. `supabase/migrations/` is the live directory.

The converted filenames carry synthetic timestamps (`20260101HHMMSS`) derived
from the original 001–030 index. They are deliberately not invented calendar
dates: the order is real and the dates are not, so the timestamps encode only
the order.

## Applying 029

Production is one migration behind. It is additive (three nullable columns and a
partial index on `plans`) and safe to apply at any time:

```bash
npx supabase link --project-ref efrcgktrlsjnzkzzuhof
npx supabase db push
```

Until it runs, the overlap gate reads overlaps live from the loaded rooms rather
than the cached column, which is why nothing is broken by its absence.
