# Frozen — historical record only

These are the thirty migrations that were applied **by hand** into the Supabase
SQL editor, before the CLI runner existed (I7).

**Nothing reads this directory.** The live migrations are `supabase/migrations/`,
applied with `npm run db:push`. See `docs/MIGRATIONS.md`.

The numbering **stops at 030 on purpose**: the live set continues as timestamped
files, so this mirror is behind by design and must stay that way. `npm run
db:check` fails if a file is added here, removed, or left unmapped to its live
counterpart.

Do not edit these files, do not add to them, and do not paste them into a SQL
editor. They are kept because they are the only record of how the production
schema was actually built, and deleting that record to tidy a folder would be a
bad trade.
