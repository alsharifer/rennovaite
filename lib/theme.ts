// =============================================================================
// lib/theme.ts — Light / Dark / System for Blueprint pages (R7 §1.8, K1).
//
// The preference lives in a cookie so the server can render <html data-theme>
// for an explicit Light or Dark choice; a tiny inline script in <head> runs
// before first paint and settles the rest (System → the OS setting, a missing
// or stale attribute), so no page ever flashes the wrong palette. It also
// follows the OS while the preference is System.
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
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function parseThemePref(value: string | null | undefined): ThemePref {
  return (THEME_PREFS as readonly string[]).includes(value ?? "") ? (value as ThemePref) : DEFAULT_THEME_PREF;
}

/** What the server can render for a preference: System is the browser's call. */
export function serverTheme(pref: ThemePref): Theme | undefined {
  return pref === "system" ? undefined : pref;
}

/**
 * Runs in <head> before the body paints. Reads the cookie (not the server's
 * attribute, which may be a cached render), resolves System against the OS and
 * keeps following it. Kept small and dependency-free: it is inlined verbatim.
 */
export const THEME_NO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)(?:;|$)/),p=m?m[1]:"${DEFAULT_THEME_PREF}",q=window.matchMedia("(prefers-color-scheme: dark)"),a=function(){d.setAttribute("data-theme",p==="system"?(q.matches?"dark":"light"):p)};d.setAttribute("data-theme-pref",p);a();if(p==="system"&&q.addEventListener)q.addEventListener("change",a)}catch(e){}})();`;

/** Browser only: store a preference and apply it at once (the switch in the rail footer, K2). */
export function setThemePreference(pref: ThemePref): void {
  document.cookie = `${THEME_COOKIE}=${pref}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
  const d = document.documentElement;
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  d.setAttribute("data-theme-pref", pref);
  d.setAttribute("data-theme", dark ? "dark" : "light");
}
