import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_SERVER_ACTION_FILES } from "../access";
import { CODE_ERRORS, normaliseCode } from "../email-code";

// K10 #2 — sign in with the code from the e-mail: works on any device, survives
// mail scanners and the PKCE link's same-browser rule, never enumerates accounts.
const ROOT = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("the e-mailed code", () => {
  it("accepts the digits a person types or pastes, and nothing else", () => {
    expect(normaliseCode("123456")).toBe("123456");
    expect(normaliseCode(" 123 456 ")).toBe("123456");
    expect(normaliseCode("123-456")).toBe("123456");
    expect(normaliseCode("12345")).toBeNull();
    expect(normaliseCode("12345a")).toBeNull();
    expect(normaliseCode("")).toBeNull();
  });

  it("the magic-link e-mail shows the code under the button, once, and keeps the link", () => {
    const html = read("supabase/templates/magic-link.html").replace(/<!--[\s\S]*?-->/g, "");
    expect(html.match(/\{\{ \.Token \}\}/g)).toHaveLength(1);
    const button = html.indexOf('<a href="{{ .ConfirmationURL }}"');
    const code = html.indexOf("{{ .Token }}");
    const paste = html.indexOf("Or paste this link");
    expect(button).toBeGreaterThan(-1);
    expect(code).toBeGreaterThan(button);
    expect(code).toBeLessThan(paste);
    expect(html).toContain("Or enter this code on the sign-in page");
    expect(html).not.toContain("{{ .TokenHash }}");
  });

  it("verifies server-side with Supabase email OTP and is a public action (the way a signed-out visitor gets in)", () => {
    const src = read("app/_actions/verify-email-code.ts");
    expect(src).toMatch(/^"use server";/);
    expect(src).toContain('verifyOtp({ email: parsed.data, token, type: "email" })');
    expect(PUBLIC_SERVER_ACTION_FILES["app/_actions/verify-email-code.ts"]).toBeTruthy();
  });

  it("no account enumeration: every failure but a rate limit is the same answer", () => {
    // The code only — the doc comment explains the rule in words.
    const src = read("app/_actions/verify-email-code.ts").replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // One failure code for a wrong code, an expired one and an address with no account.
    expect(src).not.toMatch(/not found|no account|user_not_found|signup/i);
    expect(src.match(/fail\("code_invalid"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(CODE_ERRORS).sort()).toEqual(["code_invalid", "code_malformed", "rate_limited"]);
    expect(CODE_ERRORS.code_invalid).not.toMatch(/account|registered|invite/i);
  });

  it("the sign-in form offers the code under the sent state and from the first screen", () => {
    const src = read("components/blueprint/auth/SignInForm.tsx");
    expect(src).toContain("Or enter the code from the email");
    expect(src).toContain("I have a code from the email");
    expect(src).toContain('autoComplete="one-time-code"');
    // The neutral invite-only answer gets the same code box — the form never says which addresses exist.
    const sent = src.slice(src.indexOf("if (sentTo) {"), src.indexOf("if (haveCode) {"));
    expect(sent).toContain("<CodeEntry email={sentTo} next={next} />");
    expect(sent.indexOf("<CodeEntry")).toBeGreaterThan(sent.indexOf("{notice ?"));
  });
});
