import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { DEFAULT_THEME_PREF, OFFERED_THEME_PREFS, THEME_CHOICES_OPEN, THEME_COOKIE, THEME_NO_FLASH_SCRIPT, parseThemePref, themeNoFlashScript } from "../theme";

// =============================================================================
// K1 — Light / Dark / System (R7 §1.8): a cookie the server reads, plus an
// inline script that settles the attribute before first paint.
// =============================================================================

/** Run the inline script against a fake document / matchMedia. */
function runScript(cookie: string, osDark: boolean, script = themeNoFlashScript(true)) {
  const attrs: Record<string, string> = {};
  const listeners: (() => void)[] = [];
  const media = { matches: osDark, addEventListener: (_: string, fn: () => void) => listeners.push(fn) };
  vm.runInNewContext(script, {
    document: { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
    window: { matchMedia: () => media },
  });
  return { attrs, flipOs: (dark: boolean) => { media.matches = dark; listeners.forEach((f) => f()); } };
}

describe("theme preference", () => {
  it("defaults to Light (not System) and rejects junk", () => {
    expect(DEFAULT_THEME_PREF).toBe("light");
    expect(parseThemePref(undefined)).toBe("light");
    expect(parseThemePref("sepia")).toBe("light");
    expect(parseThemePref("dark")).toBe("dark");
  });
});

describe("the K5 gate — everyone gets Light until the page bodies are converted", () => {
  it("is closed: the inlined script ignores a stored Dark / System, and only Light is offered", () => {
    expect(THEME_CHOICES_OPEN).toBe(false); // K5 flips this
    expect(OFFERED_THEME_PREFS).toEqual(["light"]);
    expect(THEME_NO_FLASH_SCRIPT).toBe(themeNoFlashScript(false));
    expect(runScript(`${THEME_COOKIE}=dark`, false, THEME_NO_FLASH_SCRIPT).attrs).toEqual({ "data-theme": "light", "data-theme-pref": "light" });
    expect(runScript(`${THEME_COOKIE}=system`, true, THEME_NO_FLASH_SCRIPT).attrs["data-theme"]).toBe("light");
  });
});

describe("the no-flash script (as it behaves once K5 opens the gate)", () => {
  it("applies the cookie before paint", () => {
    expect(runScript(`a=1; ${THEME_COOKIE}=dark`, false).attrs).toEqual({ "data-theme": "dark", "data-theme-pref": "dark" });
    expect(runScript("", true).attrs["data-theme"]).toBe("light");
  });

  it("System follows the OS, including a change while the page is open", () => {
    const r = runScript(`${THEME_COOKIE}=system`, true);
    expect(r.attrs["data-theme"]).toBe("dark");
    r.flipOs(false);
    expect(r.attrs["data-theme"]).toBe("light");
  });

  it("ignores a look-alike cookie name", () => {
    expect(runScript(`x${THEME_COOKIE}=dark`, false).attrs["data-theme"]).toBe("light");
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("the root layout never reads a cookie (static pages stay static): the inline script alone sets the theme", () => {
    const layout = read("app/layout.tsx");
    expect(layout).not.toMatch(/next\/headers|cookies\(|headers\(/);
    expect(layout).not.toMatch(/data-theme=\{/);
    expect(layout).not.toMatch(/async function RootLayout/);
    expect(layout).toContain("dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }}");
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("the root layout loads Plex Sans as --font-plex-sans beside the existing faces", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('variable: "--font-plex-sans"');
    expect(layout).toContain('variable: "--font-jetbrains-mono"');
    expect(layout).toContain('variable: "--font-eb-garamond"');
  });

  it("dark is the designed palette — never a filter", () => {
    for (const f of ["app/globals.css", "design-refs/r7-handoff/tokens.css", "lib/theme.ts"]) expect(read(f), f).not.toMatch(/invert\(/);
  });

  it("tokens.css is imported once, and every rule in it is scoped to Blueprint", () => {
    const css = read("app/globals.css");
    expect(css.match(/r7-handoff\/tokens\.css/g)?.length).toBe(1);
    const tokens = read("design-refs/r7-handoff/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...tokens.matchAll(/(^|})\s*([^{}@]+)\{/g)].map((m) => m[2]!.trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const s of selectors) for (const part of s.split(",")) expect(part, part).toContain('[data-system="blueprint"]');
  });

  it("the warm skin sits only on the owner landing and intake roots", () => {
    expect(read("app/page.tsx")).toContain('data-skin="warm"');
    expect(read("app/project/new/page.tsx")).toContain('data-skin="warm"');
    expect(read("app/rennovaite/page.tsx")).not.toContain("data-skin");
  });
});
