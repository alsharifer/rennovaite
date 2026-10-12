// =============================================================================
// lib/theme.ts — Light / Dark / System for Blueprint pages (R7 §1.8, K1).
//
// The preference lives in a cookie that ONLY the browser reads: a tiny inline
// script in <head> runs before first paint, reads it and sets <html
// data-theme> (System → the OS setting, and it keeps following the OS), so no
// page flashes the wrong palette. The server never reads it (K1 review) — a
// cookie read in the root layout would make every page dynamic.
//
// data-theme only changes Blueprint surfaces: the tokens are scoped to
// [data-system="blueprint"] (design-refs/r7-handoff/tokens.css). Atelier pages
// are light-only and ignore it. Dark is the DESIGNED palette from the tokens —
// never a colour filter over the light one.
//
// Pure and client-safe; no React.
// =============================================================================

export const THEME_COOKIE = "rv_theme";
export const THEME_PREFS = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export type Theme = "light" | "dark";

/** The default is Light (spec §1.1) — not System. */
export const DEFAULT_THEME_PREF: ThemePref = "light";

/**
 * THE GATE (K2 review): Dark and System stay hidden until K5 has converted the
 * page bodies — a dark rail around light Atelier content is not a theme.
 * Everyone gets Light: the pre-paint script ignores a stored dark / system
 * choice and the switcher offers Light only. K5 flips this to true.
 */
export const THEME_CHOICES_OPEN = false;

/** The preferences the switcher offers right now. */
export const OFFERED_THEME_PREFS: readonly ThemePref[] = THEME_CHOICES_OPEN ? THEME_PREFS : ["light"];
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function parseThemePref(value: string | null | undefined): ThemePref {
  return (THEME_PREFS as readonly string[]).includes(value ?? "") ? (value as ThemePref) : DEFAULT_THEME_PREF;
}

/**
 * Runs in <head> before the body paints. Reads the cookie, resolves System
 * against the OS and keeps following it. Kept small and dependency-free: it is
 * inlined verbatim by app/layout.tsx.
 */
export function themeNoFlashScript(open: boolean): string {
  return `(function(){try{var d=document.documentElement,m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)(?:;|$)/),p=${open ? "m?m[1]:" : ""}"${DEFAULT_THEME_PREF}",q=window.matchMedia("(prefers-color-scheme: dark)"),a=function(){d.setAttribute("data-theme",p==="system"?(q.matches?"dark":"light"):p)};d.setAttribute("data-theme-pref",p);a();if(p==="system"&&q.addEventListener)q.addEventListener("change",a)}catch(e){}})();`;
}

/** What app/layout.tsx inlines — Light only while the gate is closed. */
export const THEME_NO_FLASH_SCRIPT = themeNoFlashScript(THEME_CHOICES_OPEN);

/** Browser only: store a preference and apply it at once (the switch in the rail footer, K2). */
export function setThemePreference(wanted: ThemePref): void {
  const pref: ThemePref = OFFERED_THEME_PREFS.includes(wanted) ? wanted : DEFAULT_THEME_PREF;
  document.cookie = `${THEME_COOKIE}=${pref}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
  const d = document.documentElement;
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  d.setAttribute("data-theme-pref", pref);
  d.setAttribute("data-theme", dark ? "dark" : "light");
}
