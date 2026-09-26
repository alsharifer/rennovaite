# Auth — what exists, what it protects, what it does not (U1)

_Written 2026-09-26 with U1. Read `SPRINT_ADDENDUM.md` §7(a) for the substrate
this was built on: magic-link sessions, no middleware, RLS off, service role
on every route._

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

## The dev-auth path for scripts (not a bypass)

`scripts/lib/dev-auth.mjs → devSession("a")` mints a **real session** for the
account `dev-scripts+a@rennovaite.local`: `auth.admin.createUser` (confirmed),
`auth.admin.generateLink({ type: "magiclink" })`, then `auth.verifyOtp` with the
**anon** client — the same exchange the magic link does in a browser. The access
token goes on requests as `Authorization: Bearer …`. Needs the service-role key
(so it refuses production through `scripts/_target-guard.mjs`); the routes
contain no dev mode, shared secret or allow-list.

`scripts/firm-overlay-check.mjs [port]` uses two such accounts and asserts the
whole model live: 401 anonymous, 403 cross-firm on every route, only-my-firms
listing, and the L1 pricing invariants unchanged.

`scripts/firm-member-add.mjs <firm-id> <email>` grants membership with the
service role — the one operation the API does not offer. Needed once for the
Newspace firm 041 backfilled (no account yet → no member → unreachable until
its account signs in once and is added).

## What is NOT protected — a named deployment blocker

U1 is scope-disciplined on purpose. **Every other API route is still
unauthenticated** and runs on the service role: projects, plans, rooms,
renders, BoQ generation, uploads, corrections without firm attribution, the
document routes (gated by a pack job, not a user), pilot events. Pages do not
redirect signed-out visitors; there is no middleware/proxy; RLS is off on every
table. As of U1 that is **~44 of 49 API route files** with no caller check.

This is recorded here and in the UV deployment report as a blocker for any
deployment where more than one party uses the app. Fixing it is a platform
change — project ownership (`projects.owner_id` or a membership table), a
caller check on every route, RLS or a user-scoped client — not a firm-routes
change, and it is not this sprint's.
