import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INVITE_ONLY_MESSAGE, isInvited, parseAllowlist } from "../signup";

// H5 — account creation is invite-only; the magic link stays.

const LIST = parseAllowlist("alsharifer@gmail.com, dev-scripts+*@rennovaite.local\n  Someone@Newspace.example ; not-an-email, *@evil.example, x@*.example");

describe("the allowlist", () => {
  it("parses exact addresses (case-folded) and local-part patterns; drops junk and wildcard domains", () => {
    expect(LIST.map((e) => (e.kind === "exact" ? e.email : e.source))).toEqual(["alsharifer@gmail.com", "dev-scripts+*@rennovaite.local", "someone@newspace.example"]);
  });

  it("invites exactly the listed people", () => {
    for (const ok of ["alsharifer@gmail.com", "ALSHARIFER@gmail.com ", "dev-scripts+pipeline@rennovaite.local", "dev-scripts+a@rennovaite.local", "someone@newspace.example"]) expect(isInvited(ok, LIST), ok).toBe(true);
    for (const no of ["stranger@gmail.com", "alsharifer@gmail.com.evil.example", "dev-scripts+a@rennovaite.local.evil", "dev-scriptsX@rennovaite.local", "anyone@evil.example", "someone@newspace.example.org"]) expect(isInvited(no, LIST), no).toBe(false);
  });

  it("unset or empty = nobody new", () => {
    expect(isInvited("alsharifer@gmail.com", parseAllowlist(undefined))).toBe(false);
    expect(isInvited("alsharifer@gmail.com", parseAllowlist(""))).toBe(false);
  });

  it("the refusal is polite and does not say whether the address has an account", () => {
    expect(INVITE_ONLY_MESSAGE).toMatch(/invite-only during the pilot/);
    expect(INVITE_ONLY_MESSAGE).toMatch(/If this address already has an account/);
  });
});

describe("the door (static)", () => {
  const action = readFileSync(path.resolve(__dirname, "../../../app/_actions/sign-in-with-email.ts"), "utf8");
  it("Supabase is never asked to create an account; invited ones are created by the action itself", () => {
    expect(action).toMatch(/shouldCreateUser: false/);
    expect(action).not.toMatch(/shouldCreateUser: true/);
    expect(action).toMatch(/isInvited\(/);
    expect(action).toMatch(/auth\.admin\.createUser\(/);
  });
});
