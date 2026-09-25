# Ops runbook — what runs where, and how to get it back

_Written 2026-09-25 (O1–O3). Two pieces of the platform lived on Abdallah's PC:
the KG's Neo4j container and the backup schedule. Both were flagged "move off
before firms onboard". This is where they live now, how to restore each, and
how to roll back._

## 0. Inventory

| Piece | Lives | Configured by | Fails how |
| --- | --- | --- | --- |
| App + API | Vercel | Vercel env | — |
| Database (prod) | Supabase `efrcgktrlsjnzkzzuhof` | `.env.local` (dev), Vercel (prod) | see §2 backups |
| Database (dev) | Supabase `askzyqgcnjmbqegfifxq` | `.env.local`, CLI link | not backed up (it is a copy) |
| **KG (Neo4j)** | **Neo4j AuraDB Free** (after O1 cut-over) — until then, Docker `rennovaite-neo4j` on the PC | `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` (Vercel + inline locally) | app falls back to un-grounded prompts **silently** (`lib/kg/context.ts`, 10 s timeout per call); the daily `kg-keepalive` job goes red |
| **Backups** | **GitHub Actions** `backup.yml` → **Backblaze B2** bucket, encrypted | six `BACKUP_*` repo secrets | workflow goes red + opens an issue labelled `backup-failure` |
| Backup (previous) | `~/OneDrive/rennovaite-backups` — one manual dump, 2026-09-11 | hand-run | stale; keep as the historical restore point |

### Secrets — what exists where

| Secret | Where | Purpose |
| --- | --- | --- |
| `BACKUP_DB_URL` | GitHub Actions secret | production Postgres connection string (session pooler, `postgres.<ref>` user) |
| `BACKUP_ENCRYPTION_KEY` | GitHub Actions secret **and Abdallah's password manager** | gpg symmetric passphrase. **The only way to read a backup.** Not derivable from anything in the repo or the bucket. Losing it loses every backup taken with it. |
| `BACKUP_STORAGE_ENDPOINT` / `_KEY_ID` / `_APP_KEY` / `_BUCKET` | GitHub Actions secrets | B2 S3-compatible endpoint + an application key scoped to the one bucket |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | Vercel env (app); `.env.local` (dev, never committed); GitHub Actions secrets (keepalive only, optional) | KG connection. Aura's are `neo4j+s://<id>.databases.neo4j.io` |
| `~/backups/rennovaite/.db-url` | Abdallah's PC, outside the repo | the same production connection string, for hand-run dumps |

Nothing in this table is in git. `.env.local` is never edited by an agent
(standing rule, `SPRINT_ADDENDUM.md` §00).

---

## 1. KG — Neo4j on AuraDB

### Where it is

One AuraDB Free instance (Neo4j 5, `neo4j+s://<instance-id>.databases.neo4j.io`,
database `neo4j`). The app reaches it through the vendored retrieval agent
(`kg/retrieval/agent.ts`), which reads `NEO4J_URI` / `NEO4J_USER` /
`NEO4J_PASSWORD` and nothing else. **No code changed for the move**: the
`neo4j-driver` handles the `neo4j+s://` scheme (TLS + routing) from the URI
alone, so the cut-over is three environment variables.

The seed, loader and docker-compose remain in the separate KG module
(`C:\Users\alsha\OneDrive\Desktop\RennovAIte\RennovAIte\kg`). Reseeding a fresh
instance is the loader's job; **migrating an existing graph** is the scripts
below.

### Tooling — `scripts/kg/`

All four take the CURRENT instance from `NEO4J_*` and the CANDIDATE from
`KG_TARGET_*`, from the process environment first and `.env.local` second, so
Aura credentials are passed inline for one command and never written down:

| Script | Does |
| --- | --- |
| `export-graph.mjs [out.json]` | Reads the live graph over bolt (no downtime) into a typed JSON file — every node, relationship, property (with its Neo4j type), constraint and index — plus a fingerprint. Default output `%USERPROFILE%\backups\rennovaite\kg\kg-<stamp>.json`, outside the repo. |
| `import-graph.mjs <file> [--replace]` | Creates the constraints and indexes, then the nodes and relationships, on the target; refuses a non-empty target without `--replace`; re-reads and checks the fingerprint matches the file. |
| `verify-graph.mjs` | Proves two live instances hold the same graph: counts, per-label / per-type counts, constraints, indexes, and the full multiset of node and relationship fingerprints. Exit 1 on any difference, naming the ids. |
| `equivalence-check.ts` | Runs the KG queries **the app actually issues** (`retrieveContextBundle` for the six briefs `resolveBrief` can produce) against both and diffs the bundles. `--print` shows both prompt contexts. |

```bash
node scripts/kg/export-graph.mjs
KG_TARGET_URI=neo4j+s://xxxx.databases.neo4j.io KG_TARGET_USER=neo4j KG_TARGET_PASSWORD=… \
  node scripts/kg/import-graph.mjs "$USERPROFILE/backups/rennovaite/kg/kg-<stamp>.json"
KG_TARGET_URI=… KG_TARGET_USER=… KG_TARGET_PASSWORD=… node scripts/kg/verify-graph.mjs
KG_TARGET_URI=… KG_TARGET_USER=… KG_TARGET_PASSWORD=… \
  node --import ./scripts/_alias-hook.mjs scripts/kg/equivalence-check.ts --print
```

**A known, benign difference.** Two of the agent's queries leave order to the
planner (spaces come from a `UNION` with no `ORDER BY`; fixtures and materials
are `ORDER BY score DESC LIMIT n`, so ties fall where they fall). The
equivalence check therefore reports "identical up to tie order" rather than
byte-identical prompt text between two instances — the SAME content, in a
different order. Because the KG context is appended to the render prompt and
the prompt is the render cache key, the first render of a given room × style
after the cut-over may miss the cache once. Nothing else changes.

### Cut-over (O1 steps 2–5) — done 2026-09-25 up to the env switch

Instance: **`neo4j+s://a9bb4074.databases.neo4j.io`** (Aura Free, Neo4j
5.27-aura, Bolt 6.0, user `neo4j`; the password is in the password manager and
nowhere in this repo). The app's variable is **`NEO4J_USER`** — Aura's
credentials file calls it `NEO4J_USERNAME`; rename when pasting.

| Step | Result |
| --- | --- |
| 2 export | `kg-2026-09-25T13-41-14Z.json` — 204 / 528 / 14 / 3, no downtime |
| 3 import | 204 nodes, 528 relationships created; read-back fingerprints match the file |
| 3 verify | **IDENTICAL** — counts, 15 labels, 17 types, 14 constraints, 3 indexes, every node and relationship fingerprint |
| 3 equivalence | **EQUIVALENT** — 6/6 briefs, 0 content differences (5 tie-order-only, as expected) |
| 4 app smoke | `getKgContext` (the routes' entry point) with `KG_ENABLED=true` → GROUNDED, bundle id issued, 3.9 s cold / warm thereafter, inside the 10 s guard |
| 5 Vercel env | **pending** — Abdallah sets `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` in Production + Preview and redeploys |
| 6 keepalive secrets | **pending** — same three as GitHub Actions secrets |
| 7 stop container | **pending** — after step 5, so local dev is not left un-grounded; `docker stop rennovaite-neo4j`, never `rm` until the clean week |

Two things seen on the way: the very first driver connection to a fresh Aura
instance was reset (`ServiceUnavailable … ECONNRESET`) and every scheme
connected a minute later — a cold instance, not a config fault; and
`SHOW CONSTRAINTS` names the same constraint `UNIQUENESS` on 5.26 and
`NODE_PROPERTY_UNIQUENESS` on 5.27, which `verify-graph.mjs` now normalises.

**Rotate the Aura password** once Vercel is switched: it was supplied through a
chat window during the cut-over, which by this project's own rule counts as
disclosed (`docs/BACKUPS.md`, "Password: done").

Original step list, kept for the next instance:

1. Create the Aura Free instance in the Neo4j console; download its credentials
   file (the password is shown once). Put them in the password manager.
2. `export-graph.mjs` on the PC (container running).
3. `import-graph.mjs` into Aura; `verify-graph.mjs` must print `IDENTICAL`;
   `equivalence-check.ts` must print `EQUIVALENT`.
4. Dev server smoke: `NEO4J_URI=neo4j+s://… NEO4J_USER=… NEO4J_PASSWORD=… KG_ENABLED=true npm run dev`,
   generate one render or BoQ, confirm the log shows no `[lib/kg] KG retrieval
   failed` line and the row carries a `kg_bundle_id`.
5. Set the three variables in Vercel (Production + Preview) → redeploy.
6. Add `NEO4J_*` as GitHub Actions secrets so the daily `kg-keepalive` job runs.
7. `docker stop rennovaite-neo4j`. **Do not delete the container or its volumes
   (`kg_neo4j_data`, `kg_neo4j_logs`)** — see rollback.

### Rollback to local Neo4j

The local container is the rollback for **one week of clean Aura operation**
(seven consecutive green `kg-keepalive` runs and no `[lib/kg]` failure in the
Vercel logs). Until Abdallah confirms that week, it stays stopped-not-deleted:

```bash
docker start rennovaite-neo4j        # ~40 s to healthy
```

then point `NEO4J_URI` back at `bolt://localhost:7687` (dev) — production
cannot reach a PC, so a production rollback is "KG off" (`KG_ENABLED` unset),
which is exactly the state production has been in since the container died on
2026-09-21. After the week: `docker rm rennovaite-neo4j && docker volume rm
kg_neo4j_data kg_neo4j_logs`, and the export JSON in
`~/backups/rennovaite/kg/` is the archival copy.

### Aura Free caveats

- **Inactivity pause.** Aura Free pauses an instance after a period without
  queries and must be resumed in the console. The app would not notice — it
  falls back silently. The `kg-keepalive` job issues one query a day and goes
  red if the instance is unreachable; that is the alarm. Read the current
  pause policy in the console rather than trusting this paragraph.
- **One free instance per account**; no automated backups on Free. The export
  JSON is the backup; re-export after any reseed (`node scripts/kg/export-graph.mjs`
  with `NEO4J_*` pointed at Aura).
- The console's *Import* can also load a `.dump` if ever preferred; producing
  one needs the local database stopped
  (`docker run --rm --volumes-from rennovaite-neo4j neo4j:5-community neo4j-admin database dump neo4j --to-path=/dump`
  with the container stopped). The JSON route was chosen because it needs no
  downtime and is verified by fingerprint.

---

## 2. Backups — GitHub Actions → B2

### Where they land

Bucket `BACKUP_STORAGE_BUCKET` on Backblaze B2, S3-compatible endpoint. Objects:

```
daily/rennovaite-<YYYY-MM-DDTHH-MM-SSZ>.tar.gpg      every night
daily/rennovaite-<stamp>.tar.gpg.sha256
weekly/rennovaite-<stamp>.tar.gpg                    Sundays (Asia/Dubai), same object
weekly/rennovaite-<stamp>.tar.gpg.sha256
```

Each `.tar.gpg` is gpg-symmetric AES-256 over a tar of the dump directory:
`full.dump` (pg_dump custom format, `--schema='*'` — public + auth + storage,
sequences, functions, triggers, RLS), `schema.sql`, `VERIFIED.txt` (the script's
own scratch-restore verdict), `restore.log`, and `counts.txt` — the source's
row count per public table plus `auth_users`, `rls_policies`, `rls_enabled_*`,
recorded at dump time.

### Cadence and retention

| | |
| --- | --- |
| Schedule | `0 23 * * *` UTC = **03:00 Asia/Dubai**, daily (cron runs on the default branch only) |
| Retention | **daily 14 days · weekly 56 days** — enforced by the workflow's prune step every night (deletes every B2 version by id; B2 keeps versions, so a plain delete would only hide the file). Bucket lifecycle rules for the same windows are belt-and-braces: `workflow_dispatch` → `configure_lifecycle`, or set in the B2 console (daily/ 14 d, weekly/ 56 d, hide→delete 1 d). |
| Retention proof | `workflow_dispatch` → `prune_probe`: plants a fake object dated 2000-01-01 (two versions) and fails unless prune removes both. |
| Size | ~4 MB encrypted per night; ≈ 22 objects steady state |

### What every run proves

1. `scripts/backup-production.sh` (unchanged from I9): dump, then restore into
   a scratch container and refuse to count a dump that does not restore.
2. Upload confirmed by HEAD size.
3. **`restore-test` job** — downloads the object **from the bucket**, checks
   the sha256 sidecar, decrypts, restores into a fresh `postgres:17` container
   and compares **every public table's row count**, `auth_users`,
   `rls_policies` and the RLS-enabled table counts (`auth`, `storage`,
   `public`) against `counts.txt`. Floors: ≥ 20 public tables, ≥ 1 account,
   RLS state present on `auth` and `storage`. Any mismatch fails the run.

A run that is green has therefore restored production from the cloud copy
that night. The Actions step summary shows the counts; the logs mask every
part of the connection string (the repository is public).

### When the workflow fails

An issue labelled **`backup-failure`** is opened automatically with the run
link. Until it is closed there is no fresh off-platform backup. Usual causes:
the pooler dropped the connection three times (rerun), the database password
was rotated (update `BACKUP_DB_URL`), the B2 key was revoked (update
`BACKUP_STORAGE_*`), or the restore counts diverged (a real finding — read the
`RESTORE-TEST.txt` block in the summary before touching anything).

**`BACKUP_DB_URL` must be the session-pooler URL, not the direct host.** The
first run (#1, 2026-09-25, issue #63) failed with `Network is unreachable` on
an IPv6 address: Supabase's direct host `db.<ref>.supabase.co` has **only an
AAAA record**, and GitHub-hosted runners have no IPv6. The pooler
`aws-1-ap-southeast-1.pooler.supabase.com` (user `postgres.<ref>`, port 5432,
the same string `~/backups/rennovaite/.db-url` holds) resolves to IPv4. Set
the secret from that file without it touching a terminal or a chat window:

```bash
gh secret set BACKUP_DB_URL < "$HOME/backups/rennovaite/.db-url"
```

### Restore for real

From any machine with docker and gpg (aws-cli for the download):

```bash
export BACKUP_STORAGE_ENDPOINT=… BACKUP_STORAGE_KEY_ID=… BACKUP_STORAGE_APP_KEY=… BACKUP_STORAGE_BUCKET=…
export BACKUP_ENCRYPTION_KEY=…
bash scripts/backup-cloud/fetch.sh "" /tmp/rv-restore          # newest daily/, or pass an object key
bash scripts/backup-cloud/restore-check.sh /tmp/rv-restore/<stamp>   # proves it before you rely on it
```

Then into the real target (a fresh Supabase project, or the existing one after
a reset), never a scratch fixture's id — **always through a filtered TOC list**:

```bash
pg_restore -l /tmp/rv-restore/<stamp>/full.dump | grep -vE ' (pg_catalog|information_schema) ' > /tmp/toc.list
pg_restore --no-owner --no-privileges -L /tmp/toc.list -d "postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" /tmp/rv-restore/<stamp>/full.dump
```

**Why the filter (found 2026-09-25):** the dump is taken with `--schema='*'`,
which also captures `pg_catalog` and `information_schema` — including TABLE
DATA for `pg_catalog.pg_event_trigger`. A superuser restore `COPY`s
production's event-trigger rows into the target catalog with function OIDs
that mean something else there, and from then on **every DDL statement fails**
("event trigger functions cannot have declared arguments"), silently dropping
all 25 `ENABLE ROW LEVEL SECURITY` statements. Unfiltered: 2,981 errors, zero
RLS state. Filtered: ~45 benign errors (`pg_temp_*` schema names, `vault`)
and RLS state exactly as the I9 rehearsal recorded (auth 16/23, storage 8/8,
public 0/29). The workflow's `restore-check.sh` filters; the dump script's own
scratch verification does not (it was left unchanged on purpose — it counts
tables and projects, which survive either way). A dump-time fix would be
`--exclude-schema='pg_*' --exclude-schema=information_schema`; that is a
change to `backup-production.sh` and is logged as a follow-up, not made here.

Judge the restore on `counts.sql` (`psql … -At -F '|' -f scripts/backup-cloud/counts.sql`)
against the `counts.txt` that travelled with the dump. Storage **objects**
(renders, plan uploads, drawings) are not in a pg_dump — they are the
2026-09-05 snapshot's `storage/` folder plus whatever the buckets hold; a
storage-object backup is a separate item (`POST_DEMO_FOLLOWUPS.md` §0).

### The PC schedule

**There was none.** `docs/BACKUPS.md` gave the `schtasks /create /tn
"RennovAIte backup"` command as the remaining step; `Get-ScheduledTask` on
2026-09-25 shows no such task (the only `*backup*` matches are Windows' own
`\Microsoft\Windows\AppListBackup\…`, `\Registry\RegIdleBackup`,
`\CloudRestore\Backup`, `\Application Experience\MareBackup` — leave those
alone). So there is nothing to disable; the one manual dump in
`~/OneDrive/rennovaite-backups/2026-09-11T07-22-09Z` stays as the pre-cloud
restore point. If a task named `RennovAIte backup` ever appears:
`schtasks /delete /tn "RennovAIte backup" /f`.

---

## 3. What is still PC-dependent

| Item | Load-bearing? |
| --- | --- |
| The stopped `rennovaite-neo4j` container + volumes | No — rollback only, deletable after the clean week |
| `~/backups/rennovaite/.db-url` and `~/backups/rennovaite/kg/*.json` | No — convenience copies; the secrets live in GitHub/Vercel/password manager |
| The KG module (seed + loader) in OneDrive, its own git repo | No for runtime; **yes for reseeding** — it should be pushed to a remote like every other repo |
| `.claude/launch.json` `garden` preview entry | No — local dev convenience |
| Supabase CLI link (`supabase/.temp/project-ref`) | No — `npm run db:push` can run from any machine with the CLI logged in |
