// =============================================================================
// lib/auth/signup.ts — who may get an account (H5: the door gets a list).
//
// Magic-link sign-in stays; ACCOUNT CREATION is invite-only during the pilot.
// AUTH_SIGNUP_ALLOWLIST (env, comma or whitespace separated) names who may be
// given an account: exact addresses, or a pattern with `*` in the local part
// (`dev-scripts+*@rennovaite.local`). Unset = nobody new; existing accounts
// still sign in.
//
// The server action (app/_actions/sign-in-with-email.ts) creates an invited
// address's account itself (admin API) and never lets Supabase create one
// (`shouldCreateUser: false`) — so with Supabase's own "Allow new users to
// sign up" switched OFF, the public anon key cannot open an account either,
// and the list is the only door. Pure, so the rules are unit-tested.
// =============================================================================

export const SIGNUP_ALLOWLIST_ENV = "AUTH_SIGNUP_ALLOWLIST";

/** Shown to anyone the list does not name — worded the same whether or not the address has an account. */
export const INVITE_ONLY_MESSAGE =
  "Access to RennovAIte is invite-only during the pilot. If this address already has an account, a sign-in link is on its way; if you were invited, use the address the invitation went to.";

export type AllowEntry = { kind: "exact"; email: string } | { kind: "pattern"; re: RegExp; source: string };

const norm = (e: string) => e.trim().toLowerCase();
const ESCAPE = /[.+?^${}()|[\]\\]/g;

export function parseAllowlist(raw: string | null | undefined): AllowEntry[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map(norm)
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .map((e): AllowEntry => {
      if (!e.includes("*")) return { kind: "exact", email: e };
      const [local, domain] = e.split("@") as [string, string];
      // `*` only in the local part, and never the whole of it: a wildcard
      // domain would invite the world, a bare `*@domain` everyone at it.
      if (domain.includes("*") || local.replace(/\*/g, "") === "") return { kind: "exact", email: "" };
      return { kind: "pattern", source: e, re: new RegExp(`^${local.replace(ESCAPE, "\\$&").replace(/\*/g, "[^@\\s]*")}@${domain.replace(ESCAPE, "\\$&")}$`) };
    })
    .filter((e) => e.kind === "pattern" || e.email !== "");
}

export function isInvited(email: string, list: readonly AllowEntry[]): boolean {
  const e = norm(email);
  return list.some((a) => (a.kind === "exact" ? a.email === e : a.re.test(e)));
}
