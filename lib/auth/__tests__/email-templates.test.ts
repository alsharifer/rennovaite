import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// K8 #18 (spec §6.9, Figma 69:1422 / 69:1438): the auth e-mails' house rules,
// pinned on the template files the hosted projects are given.
const ROOT = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(ROOT, "supabase/templates", f), "utf8");

describe.each(["magic-link.html", "invite.html"])("%s", (file) => {
  const html = read(file);
  const body = html.replace(/<!--[\s\S]*?-->/g, "");

  it("is a 600 px table layout with inline styles only", () => {
    expect(body).toMatch(/<table role="presentation" width="600"/);
    expect(body).not.toMatch(/<style[\s>]/);
    expect(body).not.toMatch(/class="/);
  });
  it("is light in both themes", () => {
    expect(body).toMatch(/<meta name="color-scheme" content="light"/);
    expect(body).toMatch(/color-scheme: light/);
    expect(body).not.toMatch(/prefers-color-scheme/);
  });
  it("sets Plex with an Arial fallback, and mono with Courier New", () => {
    expect(body).toMatch(/font-family:'IBM Plex Sans', Arial/);
    expect(body).toMatch(/font-family:'JetBrains Mono', 'Courier New'/);
  });
  it("has one ink button, 44 px tall (12 + 20 + 12), zero radius, and the link as text", () => {
    expect(body.match(/bgcolor="#1A1D1F"/g)).toHaveLength(1);
    expect(body).toMatch(/padding:12px 16px; height:20px; line-height:20px/);
    expect(body).not.toMatch(/border-radius:\s*[1-9]/);
    expect(body.match(/\{\{ \.ConfirmationURL \}\}/g)!.length).toBe(2);
  });
  it("says who it was sent to and says nothing about whether an account exists", () => {
    expect(body).toContain("sent to {{ .Email }}");
    expect(body).not.toMatch(/no account|not registered|already have an account/i);
  });
});
