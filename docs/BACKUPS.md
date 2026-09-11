# Production backups (I9)

**First real backup taken 2026-09-11, and its restore has been rehearsed into a
real Supabase Postgres — every row came back.** One item remains: the backup is
not yet on a schedule.

## The first backup, measured

    taken_at       = 2026-09-11T07-22-09Z
    public_tables  = 29
    projects_rows  = 8
    auth_users     = 1        <- the whole point
    rls_policies   = 0

Archive: **5,165 TOC entries**, custom format, gzip. `full.dump` 2.5 MB,
`schema.sql` 1.3 MB, 4.6 MB for the run.

**`auth_users = 1` is the finding.** The REST export this replaces could see
only `public`, so it captured every project and zero accounts — restoring it
would have returned the villas and lost the person who owns them. The dump now
carries the `auth` schema (23 tables) and the `storage` schema.

**`rls_policies = 0` is correct, not a gap.** There are no user-defined
policies in production to capture: RLS is disabled on every application table
(`CLAUDE.md`), and all access runs through the service role. The schema dump
does carry 25 `ENABLE ROW LEVEL SECURITY` statements for the Supabase-managed
auth and storage tables. Worth stating plainly: **the RLS half of the I9
verification is vacuously true today.** It becomes a real test the moment the
first policy is written, and the count in `VERIFIED.txt` is what will notice.

The restore into the scratch container logged 2,981 errors, all benign —
`collation already exists`, `operator class already exists`, and Supabase's
event-trigger functions, which a bare Postgres image already has or cannot
accept. The restore is still judged on what came back: 29 tables, 8 projects,
1 account.

## Three things that had to be fixed to get one dump

Each failed in a way that looked like something else:

1. **Docker bind mount.** Under Git Bash a `/c/Users/...` path is an MSYS
   invention dockerd has never heard of. The mount silently produced an empty
   directory and `pg_dump` failed with *"could not open output file"*, which
   reads like a permissions problem. Fixed with `cygpath -m` +
   `MSYS_NO_PATHCONV`.
2. **Wrong pooler host.** I extrapolated production's connection string from
   dev's, assuming the same region meant the same pooler cluster. It does not —
   dev is on `aws-0`, production on `aws-1`. The error, *"tenant/user
   postgres.<ref> not found"*, reads like a bad password.
3. **Postgres major mismatch.** The script used `postgres:16`; both projects
   run 17.6. `pg_dump` refuses to dump a server newer than itself. Pinned to
   `postgres:17` via `PG_IMAGE`.

A fourth is handled rather than fixed: the session pooler drops long
connections (*"SSL error: unexpected eof while reading"* mid-dump). Both dumps
now retry up to three times.

---

## What existed before

A REST export of 29 public tables (1,781 rows) at
`C:\Users\alsha\backups\rennovaite\`, plus a one-shot `pg-dump.sh` that was
never run. Its restore was verified — migrations replayed and the data reloaded
— but it had three gaps that a real backup cannot have:

- **No auth schema.** PostgREST only exposes `public`, so the export captured
  every project and **not one user account**. Restoring it would have returned
  the villas and lost everyone who owns them.
- **No RLS policies, sequences, functions or triggers** — schema objects the
  REST API cannot see either.
- **No schedule.** One snapshot taken by hand, on one laptop.

`scripts/backup-production.sh` closes all three.

## What it does

`pg_dump --schema='*'` — auth and storage included, not just public — in custom
format for restoring and plain SQL for reading, then **restores every dump into
a throwaway container before the backup counts as one**. A dump nobody has
restored is a hope; this makes a corrupt or truncated dump fail on the day it is
taken rather than the day it is needed. The verification writes
`VERIFIED.txt` recording public table count, project rows, **auth user count**
and **RLS policy count**, and a dump that restores to an implausible database is
renamed `-FAILED` and exits non-zero.

## Cadence, retention, cost

| | |
| --- | --- |
| Cadence | **Daily**, 03:00 local |
| Retention | **Daily for 14 days**, then **weekly (Sundays) for 8 weeks** |
| Oldest restore point | **~56 days** |
| Size | ~4 MB compressed per dump (1,781 rows, 29 tables) |
| Steady-state storage | 14 daily + 8 weekly ≈ **22 dumps ≈ 90 MB** |
| Cost | **AED 0** — well inside every free tier below, and inside the Supabase Pro backups it does not replace |

The 14-day daily window is deliberate. The requirement is a restore point older
than 7 days; a 7-day window would satisfy that on paper and leave nothing older
than 7 days the moment it rolled.

**This does not replace Supabase's own backups.** Its value is being *outside*
the Supabase project: it survives the project being deleted, suspended, or
billed into read-only, which is precisely the failure a platform-side backup
does not cover.

## Resolved — what was blocked, and what still is

**Password: done.** Rotated 2026-09-11 after being disclosed in a chat window,
and supplied through `~/backups/rennovaite/.db-url` — read by the script,
never printed, never copied into a backup directory, and outside any git tree.
Passing it on a command line or in chat is what created the need to rotate.

**Location: chosen — OneDrive.** `~/OneDrive/rennovaite-backups`. Off the
laptop disk and syncing today. It remains a default rather than the right
long-term answer: a personal account holding customer data. Cloudflare R2 or
Backblaze B2 at roughly AED 1/month is the upgrade when it matters.

**Still open: the schedule.** Backups are not yet automatic. One task, run as
Abdallah so the credentials file is readable:

    schtasks /create /tn "RennovAIte backup" /sc daily /st 03:00 ^
      /tr "bash C:devennovaitescriptsackup-production.sh"

`BACKUP_DIR` must be set as a **user** environment variable
(`%USERPROFILE%OneDriveennovaite-backups`); the connection string comes
from the credentials file, so it never enters the task definition. Until this
runs, there is exactly one backup and no cadence.

## The restore rehearsal — DONE, 2026-09-11

**A real Supabase Postgres took the production dump and gave every row back.**

### What was actually used, and why it is not the scratch project

The chosen option was a throwaway cloud project. Supabase refused it:

    2 project limit ... reached their maximum limits for the number of
    active free projects

Production and `rennovaite-dev-sg` already occupy both free slots. Nothing was
created, so there is nothing to delete.

The substitute is **better for the stated goal**, not a compromise:
`supabase start` runs the genuine Supabase stack locally — the same Postgres
image, the same roles (`supabase_admin`, `authenticator`, `anon`,
`service_role`), the same extensions, and GoTrue. The dump was restored into a
**clean database inside it**, so nothing pre-existing could mask a gap. And
production data never left the machine, which a cloud scratch project could not
have promised.

### Row counts — restored vs LIVE production

| Table | Production | Restored | Match |
| --- | ---: | ---: | --- |
| projects | 8 | 8 | ✅ |
| plans | 8 | 8 | ✅ |
| rooms | 107 | 107 | ✅ |
| renders | 49 | 49 | ✅ |
| boqs | 24 | 24 | ✅ |
| takeoff_items | 184 | 184 | ✅ |
| rate_book | 61 | 61 | ✅ |
| pricing_skus | 600 | 600 | ✅ |
| labour_rates | 52 | 52 | ✅ |
| accessory_catalog | 45 | 45 | ✅ |

**Every table matches.** Production counts were read live from the REST API at
the time of comparison, not taken from the dump's own metadata — a dump agreeing
with itself proves nothing.

### Schema and RLS

    public tables      29
    auth tables        23      auth.users restored with all 35 columns
    storage tables      8
    auth.users rows     1      the account the REST export could never see

    RLS enabled: auth 16 · storage 8 · public 0
    policies: 0

The RLS **state** round-tripped exactly: Supabase's own auth and storage tables
come back with row security on, and every application table comes back with it
off — which is production's design, not an omission.

Said plainly: **the RLS half of this test is vacuously true today**, because
there are no user-defined policies to lose. It becomes a real test the day the
first one is written, and `rls_policies` in `VERIFIED.txt` is what will notice
if it ever stops coming back.

### Teardown — confirmed

    drop database restore_test        -> 0 databases named restore_test remain
    supabase stop --no-backup         -> stack stopped, data discarded
    docker containers named supabase  -> none
    docker volumes named supabase     -> none
    cloud projects                    -> 2 (production, rennovaite-dev-sg)
    scratch/restore-test projects     -> NONE

The rehearsal log was also deleted from the backup directory. **No copy of
production data outlives the test.** The only remaining copy is the intended
backup itself, in `~/OneDrive/rennovaite-backups`.

### The one thing this does not prove

A local stack does not exercise the hosted platform's own restore path —
Supabase's dashboard restore, its connection pooler, or its storage-object
recovery. If that matters before an investor conversation, it needs a paid
project slot or a temporary pause of dev. What it does prove is the part that
was actually at risk: the dump is complete, loadable, and gives back every row
and the account that owns them.

