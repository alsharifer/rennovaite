# Auth — what exists, what it protects, what it does not (U1, H1)

_Written 2026-09-26 with U1. Read `SPRINT_ADDENDUM.md` §7(a) for the substrate
this was built on: magic-link sessions, no middleware, RLS off, service role
on every route. **H1 (2026-09-29) requires a session everywhere** — see
"A session everywhere (H1)" below, and "What H1 does NOT do" for what a
session still does not entitle._

## The ownership model (minimal; no teams, no roles)

- **`firm_members (firm_id, user_id)`** (migration 043). A firm belongs to one
  or more accounts. **Creating a firm makes you a member.** There is no
  invitation, no role and no owner flag yet — every member can do everything
  the API offers for that firm, including delete it.
- **Membership is required** for every `/api/firms/:firmId/*` route, for
  `GET /api/firms` (which now returns only the caller's firms), for attaching a
  firm to a project (`PATCH /api/projects/:id { firm_id }` — and detaching one,
  which needs membership of the firm being detached), and for attributing a
  BoQ correction to a firm (`POST /api/boq-corrections` with `firm_id` or
  `attributed_to`).
- **U4 adds** (2026-09-27): `GET /api/firms/:firmId/rates/history` (members);
  `POST /api/projects/:id/boq-approvals` — a signed-in caller, and a MEMBER of
  the project's firm when it has one (403 `not_a_member` otherwise);
  `GET /api/projects/:id/boq-revisions`, `GET …/boq-diff` and `GET
  …/boq-approvals` require a signed-in caller (401) — a revision history is a
  price history. The revisions page (`/project/[id]/boq/revisions`) shows a
  sign-in card to a visitor. Rate entries record `created_by` / `retired_by`
  (the trail); the history route resolves those ids to e-mails for the firm's
  own members only.
- **L4 adds** (2026-09-27): `GET/PATCH/POST /api/firms/:firmId/branding`
  (members); `POST /api/projects/:id/reference-basis` — a MEMBER of the
  project's firm accepts the reference basis for one BoQ revision (422 when
  the project has no firm; 401/404/403 as everywhere); `GET …/reference-basis`
  requires a signed-in caller. `GET /api/projects/:id/proposal` is a document
  route behind the pack-job guard (T5) — and, since H1, a signed-in caller.
- **L5 adds** (2026-09-28): `GET /api/pilot-events?firm_id=` requires a
  signed-in caller (401); `POST /api/pilot-events` (friction, decisions,
  support touches) records the caller as `actor` (open at L5; since H1 it needs
  a signed-in caller like every route); the BoQ page records `boq_viewed` only for a signed-in viewer. Every
  event writer stores the actor it knows; a null actor means a script or our
  own run — the pilot's metrics say so.
- **Answers, in this order** (`lib/firms/store.ts → requireFirm`):

  | | code | when |
  | --- | --- | --- |
  | 401 | `unauthenticated` | nobody is signed in — before anything is looked up, so an anonymous call learns nothing about which firms exist |
  | 404 | `firm_not_found` | no such firm |
  | 403 | `not_a_member` | the firm exists and the caller is not a member — **on authentication grounds**, not 404-by-scoping |

  Underneath, the L1 scoping still holds: an entry id from firm B addressed
  through firm A's own path is 404 for A's member, and B's row is untouched.
- **Enforced in application code, on purpose.** The routes run on the
  service-role client, which bypasses RLS; a policy would protect nothing. The
  check lives in the one function every firm operation enters through.

## Who is asking — `lib/auth/caller.ts`

`getCaller(request)` returns `{ id, email }` or `null`:

1. `Authorization: Bearer <jwt>` — a Supabase user JWT, verified with the auth
   server (`auth.getUser(jwt)`); a forged or expired token is `null`, never a
   user. This is how scripts call.
2. otherwise the cookie session `@supabase/ssr` holds after a magic-link
   sign-in. This is how the browser calls.

The routes cannot tell the two apart, and nothing reads an identity from a
request body.

## Sessions

- Sign in: magic link (`app/_actions/sign-in-with-email.ts` → `/auth/callback`).
- **Sign out (new in U1):** `app/_actions/sign-out.ts`, the `logout` button in
  the top bar (shown only when a session exists). Clears the cookies, lands on
  `/auth`.
- No browser Supabase client was added: no UI reads firm data yet, and the
  server action + cookie session cover what exists. Add one when a firm page
  needs client-side calls.

## A session everywhere (H1)

Every API route and every app page needs a signed-in caller, except the
explicit allowlist in `lib/auth/access.ts` — the one list both layers below
read:

| Public | Why |
| --- | --- |
| `/auth/callback` (route handler) | the magic link lands here before any session exists |
| `/api/health` | liveness for uptime checks — anonymous callers get env *presence* only; the key fingerprints need a session |
| pages `/`, `/rennovaite`, `/auth`, `/privacy`, `/terms` | the landing surfaces, sign-in, the legal pages the footer links |
| server actions `sign-in-with-email`, `sign-out` | getting and ending a session |

Static assets (`/_next/*`, anything served from `public/`) never reach the proxy.

**Two layers, one allowlist.**

1. **`proxy.ts`** (Next 16's renamed middleware) runs before every route. It
   verifies the caller with `getClaims` — the Bearer JWT, else the cookie
   session — which on an ES256 project (dev is) checks the signature locally
   against the cached JWKS: ~5–15 ms a request. Off the allowlist an API route
   answers `401 { error: "Sign in required.", code: "unauthenticated" }` and a
   page redirects `307 /auth?next=<path>`. It fails closed when Supabase is not
   configured, rejects anonymous-sign-in JWTs, and refreshes the cookie session
   (the @supabase/ssr pattern — a Server Component cannot write cookies). The
   matcher takes `/api/:path*` whole (a dot in a dynamic segment is still an API
   path) and every page except `_next/`, the dev overlay and file-extension paths.
2. **Every handler** — 97 across the 61 API route files — opens with
   `const caller = await getCaller(request); if (!caller) return unauthenticated(…);`
   and awaits nothing but its route params before it, because a proxy can be
   skipped (a matcher change, an odd path) and the handler cannot. Server
   actions do the same with `getCaller()` — the proxy sees a POST to a page, not
   which action rides on it. `lib/firms/__tests__/route-auth.test.ts` scans
   every route file and every `"use server"` file and fails the suite on a
   handler that does not; a public one must be listed, with its reason, in
   `lib/auth/access.ts`.

So a route now answers 401 first, then its own answers (404 flag-off, 400,
the firm routes' 404/403, the document routes' pack-job 403, …).

- **Back where you were going.** The sign-in form keeps `next` in a short-lived
  cookie scoped to `/auth/callback` (`rv_auth_next`, same-site paths only —
  `safeNextPath` refuses `//host` and schemes); the e-mailed link is unchanged,
  so the Supabase redirect allowlist is too.
- **The pack export acts as the member who started it.** The in-app Export
  pack's `after()` job calls this app's own routes over HTTP. It forwards the
  starter's credential (`forwardableAuthorization`: a Bearer as-is; a cookie
  session's access token, refreshed first if it would expire within the job's
  budget) as `Authorization: Bearer`. The pack-job header still authorises the
  documents; the session authenticates the request — neither stands in for the
  other. Inside a job, `generate-boq`'s event keeps the JOB's actor, so a
  member's export is the firm's and a CLI job (no actor) stays ours, exactly as
  before.
- **Pages accept a Bearer at the proxy** (scripts read BoQ pages that way), but a
  page's own `getCaller()` reads the cookie session only — a scripted page read
  records no `boq_viewed`.
- **Live check:** `node scripts/route-auth-sweep.mjs [port]` derives every
  handler and page from the filesystem and asserts: every off-allowlist handler
  401s anonymously and with a forged or expired Bearer; dotted and unknown
  `/api` paths 401; every gated page redirects to `/auth?next=…`; the public
  surfaces answer; and a signed-in dev account gets past the gate on every GET.
  At H1: 97/97 handlers, 24/24 gated pages, 35/35 signed-in GETs.

## The dev-auth path for scripts (not a bypass)

`scripts/lib/dev-auth.mjs → devSession("a")` mints a **real session** for the
account `dev-scripts+a@rennovaite.local`: `auth.admin.createUser` (confirmed),
`auth.admin.generateLink({ type: "magiclink" })`, then `auth.verifyOtp` with the
**anon** client — the same exchange the magic link does in a browser. The access
token goes on requests as `Authorization: Bearer …`. Needs the service-role key
(so it refuses production through `scripts/_target-guard.mjs`); the routes
contain no dev mode, shared secret or allow-list.

**H1: every script that calls the app does it this way.** `devFetch(who)` (same
module) is a fetch that adds the dev session's Bearer, mints on first use and
again within five minutes of expiry; `.authorization()` feeds the CLI pack
transport. Pipeline, seeding and verification scripts call as
`dev-scripts+pipeline@rennovaite.local`; the privacy checks keep their a/b
stand-in members; headless-Chrome scripts set the same session as the cookies
@supabase/ssr writes. One consequence for the L5 metrics: an event a script
causes OUTSIDE a pack job now names that script account as its actor rather
than null (identifiable by its `rennovaite.local` e-mail; stages still classify
it). Inside a pack job the job's actor is used, as above.

`scripts/firm-overlay-check.mjs [port]` uses two such accounts and asserts the
whole model live: 401 anonymous, 403 cross-firm on every route, only-my-firms
listing, and the L1 pricing invariants unchanged.

`scripts/firm-member-add.mjs <firm-id> <email>` grants membership with the
service role — the one operation the API does not offer. Needed once for the
Newspace firm 041 backfilled (no account yet → no member → unreachable until
its account signs in once and is added).

## Quotes (U3) — supplier documents and the repository

A quotation is a firm's private business with its supplier. What the app keeps
is the RECORD (`firm_quotes`: the label the firm chose, reference, dates,
terms, the file's name and sha256) and the LINES; the uploaded workbook itself
is not stored. Every rate created from a quote carries `origin =
'quote_import'` and the quote's id; on a BoQ line it reads as the constant
"contractor rate book (supplier quotation)" — the supplier's label reaches no
document (test-asserted).

**Fixture rule.** Exactly one quotation fixture exists in the repository,
`lib/quotes/__fixtures__/synthetic-quote.xlsx`, generated by
`scripts/make-synthetic-quote.mjs` from invented rows (its sha256 is pinned in
`lib/quotes/__tests__/xlsx.test.ts`). **No real supplier or contractor
document is ever committed.** If one is ever needed locally to debug a parse,
it lives outside the tree (`~/backups/rennovaite/quotes/`, say), and what goes
into a commit message or an issue is its **sha256 only**, never the file, its
name, or a line from it.

## What H1 does NOT do — stage 2, still a deployment blocker

_Until U1 no route checked the caller; after U1 ~44 of 49 still did not. Since
H1 every route and page needs a session._ A session is still not an entitlement:

- **Anyone with an e-mail inbox can get a session.** Magic-link sign-in creates
  the account on first use (`signInWithOtp` defaults to `shouldCreateUser:
  true`; H1 did not change the Supabase project's sign-up setting). "Signed in"
  means "controls some inbox", not "is a pilot user". Closing that is an
  invite-only switch — `shouldCreateUser: false` with provisioned accounts, or
  sign-ups disabled in the dashboard — and it is a product decision.
- **No ownership.** Any signed-in account reaches every project's routes and
  pages; projects have no owner, and the firm routes remain the only
  membership-scoped surface. Stage 2 is project ownership (`projects.owner_id`
  or a membership table) checked where every handler now resolves its caller.
- RLS is still off on every table; routes still run on the service role and
  pages still read through the admin client.

This stays recorded as a blocker for any deployment where more than one party
uses the app.
