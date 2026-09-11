# Production backups (I9)

**First real backup taken 2026-09-11.** Verified by restoring it. One item
remains open and it is a governance decision, not a technical one — see
"The restore rehearsal" at the end.

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

## The restore rehearsal — needs a decision, not more code

I9 asks for the restore to be tested **against the dev project**. Doing that
literally would load production into dev, and that collides head-on with the I8
deviation you approved: dev deliberately holds no commercial data — no Atrium,
Global Creation, Laspinas or RAK quotation, no BoQ, no real account.

Restoring the production dump into dev would put all of it there, and **Vercel
Preview points at dev**, so during the window every preview deployment would be
reading live customer data. Wiping afterwards does not undo that window.

So this is a data-governance call, and it is yours:

| Option | What it proves | Cost |
| --- | --- | --- |
| **A · Scratch project** (recommended) — spin up `rennovaite-restore-test`, restore into it, verify, delete it | Everything dev would prove: real Supabase roles, extensions, auth schema | ~15 min, free tier, and production data never touches an environment anything is pointed at |
| **B · Into dev, then reset** | Same, but dev holds production data for the duration | Preview reads live data during the window; dev must then be dropped, re-pushed and re-seeded |
| **C · Container only** (what runs today) | The dump is readable and complete | Already automatic per run; does not prove a *live Supabase project* will take it |

**A is the recommendation.** It gets the full value of the rehearsal without
ever pointing a live environment at customer data, and it costs one throwaway
project. Say which and I will run it.
