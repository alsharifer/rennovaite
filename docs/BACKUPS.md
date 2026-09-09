# Production backups (I9)

**Status: built, not yet running. Two things are needed from Abdallah, below.**

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

## Blocked on Abdallah

### 1 — The database password

`pg_dump` needs it. It is not in `.env.local` and cannot be derived from the
service-role JWT.

- <https://supabase.com/dashboard> → project `efrcgktrlsjnzkzzuhof` →
  **Settings → Database → Connection string → URI**
- Reveal and copy the password
- **Do not paste it into a chat window.** Put it in your password manager, then
  in your own shell:

```bash
export SUPABASE_DB_URL='postgresql://postgres.efrcgktrlsjnzkzzuhof:<password>@<host>:5432/postgres'
```

If you also create the dev project (I8), save that password at the same time —
it cannot be recovered later, only reset.

### 2 — Where the backups live: choose one

**My default recommendation: OneDrive.** It is already on this machine, already
syncing, private to your account, and costs nothing extra. It gets the dumps off
the laptop's disk today, which is the gap that matters most.

```bash
export BACKUP_DIR="$HOME/OneDrive/rennovaite-backups"
```

It is a default, not the right long-term answer: OneDrive is a personal account,
not company-controlled, and it holds customer data. Two alternatives, if you
would rather:

| Option | For | Against |
| --- | --- | --- |
| **OneDrive** (default) | Zero setup, already syncing, offsite today | Personal account; customer data on consumer storage |
| **Cloudflare R2 / Backblaze B2** | Company-owned, no egress fees, ~AED 1/month at this size | Needs an account and a key; ~1 hour |
| **A second physical disk** | Cheapest, fully controlled | Not offsite — fire and theft take both copies |

Once chosen, schedule it (Windows Task Scheduler, daily 03:00):

```
schtasks /create /tn "RennovAIte backup" /sc daily /st 03:00 ^
  /tr "bash C:\dev\rennovaite\scripts\backup-production.sh"
```

The task needs `SUPABASE_DB_URL` and `BACKUP_DIR` in its environment — set them
as **user** environment variables so the password is not in the task definition.

## The restore test is the deliverable, and it is not done

I9 asks for the restore to be **tested against the dev project from I8**. That
project does not exist yet, so:

- **Blocked on:** the dev Supabase project (I8 step 1) **and** the database
  password (above).
- **What will be verified when both exist:** restore the dump into dev; compare
  row counts per table against production; confirm `auth.users` restores with
  its rows; confirm `pg_policies` count matches. Restoring into dev rather than
  a scratch container is what makes it a real rehearsal — same Supabase
  extensions, same roles, same shape of failure.

Until then the per-run container restore in the script is a genuine check that
the dump is *readable and complete*, but it is not the same as proving it
restores into a live Supabase project.
