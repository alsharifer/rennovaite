# Onboarding runbook — firm #2 (H6)

_Written 2026-09-30 against the H1–H5 stack (session everywhere, project
ownership, invite-only sign-up, flag-independent pricing, in-app regenerate).
Every step names the surface it uses and what "done" looks like. Do them in
this order: each step's check is only meaningful if the step before it held._

## Read this first — which database

**The pilot's firm data lives on DEV today.** Checked 2026-09-30:

| | dev (`askzyq…`) | prod (`efrcgk…`, www.rennovaite.fit) |
| --- | --- | --- |
| Firms | Newspace `8eaec06d-6c0d-4bb8-8609-79e941fcc82c` (from 041, **no member**) | **none** |
| Arabella project | `ec4497c7-71a7-44f5-9f4b-f5a731002d0d`, `firm_id` unset | **does not exist** |
| Abdallah's account | absent | exists (never signed in); owns all 9 projects via 050 |

So onboarding firm #2 **on prod** means: their firm is created fresh on prod
(step 2a), and a garden pilot needs its project on prod first (see
"Arabella's decision point"). Onboarding on dev uses the steps as written, with
the Newspace branch (2b). Decide which environment the pilot runs on before
step 1 — nothing below moves data between them.

Operator scripts take the target from `.env.local` and **refuse production**
unless run with `ALLOW_PROD_WRITE=1` (`scripts/_target-guard.mjs`). For prod,
point `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` at prod for that
one command only.

## Preconditions (once, before any firm)

- The H1–H5 deploy is live, and migration **050** was applied to the target
  database **before** that code (`npm run db:push`; the membership read fails
  closed without the table).
- Supabase → Auth → **"Allow new users to sign up" is OFF** on the target
  project. Otherwise the public anon key can open accounts directly and the
  invite list is decorative.
- Abdallah has signed in once on the target (prod: his account exists; dev:
  run `node scripts/project-member-add.mjs alsharifer@gmail.com --all` after
  his first dev sign-in).

## 1. Create / verify the account

1. Add the firm member's address to **`AUTH_SIGNUP_ALLOWLIST`** (Vercel →
   Production env for prod; `.env.local` for dev). It is read at server start:
   **redeploy / restart** after changing it.
2. They open `/auth` on the target, enter that exact address, and click the
   emailed link **in the same browser** (the magic link is PKCE-bound to the
   browser that asked for it). They land on `/project` → `/project/new`.
3. **Done when** the address appears under Supabase → Auth → Users, and
   `/dashboard` shows them an empty portfolio (they own nothing yet — correct).
   An address not on the list sees "Access to RennovAIte is invite-only during
   the pilot…" and gets no account.

## 2. The firm

**2a — a new firm (every firm on prod, including Newspace):** they open
`/firms` → create the firm. Creating a firm makes them its member.

**2b — Newspace on dev (the firm 041 backfilled, which has no member):**

```bash
node scripts/firm-member-add.mjs 8eaec06d-6c0d-4bb8-8609-79e941fcc82c <their-email>
```

Their account must exist first (step 1), or the script says so and stops.

**Done when** `/firms` lists the firm for them and `/firms/<id>` opens its
(empty) book. Nobody else sees it: `/firms` is the caller's firms only.

## 3. Attach the project (both memberships)

A firm is attached to a project by someone who is a member of **both** the
project and the firm (`PATCH /api/projects/:id { firm_id }` answers 403
`not_a_project_member` / `not_a_member` otherwise).

1. **Make the firm member a project member** (an operator act — there is no
   invitation UI yet):

   ```bash
   node scripts/project-member-add.mjs <their-email> <project-id>
   ```

2. **Baseline regenerate, BEFORE attaching.** On `/project/<id>/boq` press
   **Regenerate BoQ**. The latest stored revision may predate code changes
   (prod Mudon's 5 Sep BoQ moves +AED 15,247 from the approved S6-pre lines —
   see CLAUDE.md "Pricing never depends on a flag (H3)"). Absorbing that drift
   now is what makes step 4's "unchanged" check mean something.
3. **Attach.** There is no attach control yet. From the firm member's signed-in
   browser tab on the target (DevTools → Console):

   ```js
   await fetch("/api/projects/<project-id>", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ firm_id: "<firm-id>" }) }).then((r) => r.status)
   ```

   **Done when** it returns `200` and the BoQ page's reference-basis notice now
   names the firm and its book status (Draft). Every line is still priced from
   the reference until the book has entries. Detaching needs membership of the
   firm being detached as well.

## 4. Regenerate — the BoQ must NOT move

With the firm attached and its book **empty** (no entries, OH&P not set yet),
press **Regenerate BoQ** and follow **"See exactly what moved"**.

- **Expected: nothing moved** — same total as the baseline revision, zero lines
  in the diff. An empty book shadows nothing, and flags do not price (H3).
- **Any movement here is a bug.** Stop, keep both revision ids, and do not
  continue: the diff page names each line that moved and whether a record
  explains it.
- Do not set OH&P before this check — OH&P is a real, intended movement and
  would mask one that is not.

## 5. Build the book from the written review

Every change below returns the book to **Draft** and is recorded as a
`rate_book_change` event; each one shows up as a cause on the next revision
diff.

- **Typed rates** (`/firms/<id>` → add entry): key, unit, rate, kind are
  validated against the take-off vocabulary. A figure edit supersedes the old
  row (kept in history), it never overwrites it.
- **A supplier quotation** (`/firms/<id>` → Quotes): download the template, have
  it filled, upload with the quote's terms, review each suggested match (nothing
  is auto-confirmed), accept. Accepted lines become `quote_import` entries.
- **Corrections from the review:** captured on the BoQ page's review panel —
  **garden projects only** (`GARDEN_PILOT_ENABLED`; an interior BoQ has no
  capture UI, so an interior review goes in as typed rates or a quotation). A
  captured correction changes nothing until promoted, once, by a firm member
  (API only — no button yet):

  ```js
  await fetch("/api/firms/<firm-id>/promote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ correction_id: "<correction-id>" }) }).then((r) => r.status)
  ```

- **OH&P** (`/firms/<id>` → OH&P %): applied last, as its own BoQ row.

Then **Regenerate** and read the diff: every moved line should name the
rate-book change that moved it; a line that moved with "no cause recorded" is
a question for the review, not a detail.

## 6. Mark the book reviewed

`/firms/<id>` → status **Reviewed** — the firm's statement that the book is its
own, checked. Any later change (entry, OH&P, promotion, quote accept) returns
it to Draft.

## 7. Flags checklist per pilot type

Flags are read at server start (Vercel env → redeploy). They gate UI, never
pricing (H3). **Prod today** (measured 2026-09-29): drawings, overlays, 3D
viewer, what-if, staging, permit check and the Property OS landing are
effectively ON; `GARDEN_PILOT_ENABLED`, `PACK_EXPORT_ENABLED`,
`TASTE_SEED_ENABLED` are unset; `TEXTURED_WALKTHROUGH` is set but not `"true"`;
`KG_ENABLED` is set with a value that cannot be read back.

| Flag | Interior pilot | Garden pilot | Why |
| --- | --- | --- | --- |
| `PACK_EXPORT_ENABLED` | **on** | **on** | the proposal is exported through Export pack (needs `DRAWINGS_ENABLED` too) |
| `DRAWINGS_ENABLED` | **on** | **on** | drawing set + the pack's document routes |
| `GARDEN_PILOT_ENABLED` | off | **on** | authored plans, outdoor zones, runs, the site panel, correction capture |
| `OVERLAYS_ENABLED` | on | on | the electrical / plumbing / garden layers and services sheets (pricing reads fixtures regardless) |
| `WHATIF_ENABLED` | optional | optional | grade scenarios on the BoQ page |
| `VIEWER_3D_ENABLED` | optional | optional | view-only walkthrough |
| `PERMIT_CHECK_ENABLED` | on | on | permit-trigger checklist on the hub / BoQ |
| `STAGING_ENABLED` | optional | off | interior furniture section only |
| `TASTE_SEED_ENABLED` | optional | optional | moodboard-conditioned renders (garden preset) |
| `KG_ENABLED` | off unless Aura is healthy | same | a stopped graph costs a 10 s timeout per call |
| `AUTH_SIGNUP_ALLOWLIST` | the firm's addresses | same | step 1 |

## 8. First proposal export (through the reference-basis gate)

1. **Branding** (`/firms/<id>` → Proposal branding): display name, logo
   (PNG/JPG ≤ 1 MB), terms text — the firm's words, printed verbatim.
2. **Client-facing project name** (set in the Export pack panel): a working name
   ("…(scratch)", "…(ground truth)", "…(dev)") blocks the export.
3. `/project/<id>/drawings?export=1` → **Export pack** → **Include the client
   proposal**. The checklist's `reference_basis` item passes when ANY of:
   - every line is priced from the firm's own book (`firm_basis`), or
   - the book is **Reviewed** (`book_reviewed` — step 6), or
   - a firm member accepted the reference basis for **this** revision on the BoQ
     page (`accepted` — a stated choice to send market-reference rates; any
     moved line needs a new acceptance).
4. Run it. **Done when** the downloads include `<name>-proposal.pdf` and every
   printed-content check passed (brand on the cover, prepared-with mark on every
   page, no rate provenance, contract sum = BoQ total, OH&P row, terms,
   programme, and no other firm's or contractor's name).

## Newspace-specific steps

- **Dev:** their firm exists (`8eaec06d-…`) with no member and no book — step
  2b, not 2a. Their session corrections on Arabella are recorded (`boq_corrections`
  attributed to Newspace) but **not promoted**: nothing of theirs prices
  anything until a member promotes it (step 5).
- **Prod:** they do not exist. Step 2a creates the firm; their dev corrections do
  not travel. Decide whether the prod pilot re-enters the written review there
  (step 5) or starts from their own quotation.
- Their address goes on `AUTH_SIGNUP_ALLOWLIST` before they can sign in at all.

## Arabella's decision point — `projects.firm_id`

Arabella (dev `ec4497c7-…`, no prod copy) is unattached **by decision**:
attaching a firm is a pricing and identity decision, not a data repair.

- **Attach Newspace** → Arabella prices from Newspace's book (tiers 1–2 before
  the reference), Newspace's name may appear on Arabella's documents, and its
  proposal is Newspace's to send. Do step 3's baseline regenerate first, and
  expect step 4 to show no movement until their book has entries.
- **Leave unattached** → Arabella stays our reference-priced draft; Newspace can
  still review it as a **project member** (step 3.1) without its rates or name
  touching it, and no proposal can be exported for it (a proposal is a firm's
  document).
- **For a prod pilot on Arabella**, the project must exist on prod first. Nothing
  here copies it; that is its own decision (client photos and geometry move
  with it).

## Reversing a step

- Detach a firm: the same console call with `"firm_id": null`.
- Remove a project member: delete the `project_members` row (service role); the
  proxy refuses their next page load.
- A rate: retire it in the book (kept in history, never deleted).
