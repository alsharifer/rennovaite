"use client";

// =============================================================================
// components/blueprint/ThemeSwitch.tsx — "Theme · Light / Dark / System"
// (R7 §1.8). Lives in the rail footer from K2; K1 ships it with the mechanism.
// A real radio group (spec §4.2 #9): arrow keys move, the choice applies at
// once and is stored in the cookie the root layout reads.
// =============================================================================

import { useSyncExternalStore } from "react";

import { DEFAULT_THEME_PREF, OFFERED_THEME_PREFS, parseThemePref, setThemePreference, type ThemePref } from "@/lib/theme";

const LABEL: Record<ThemePref, string> = { light: "Light", dark: "Dark", system: "System" };

// The preference lives on <html data-theme-pref> (set by the no-flash script
// and by setThemePreference) — an external store, read without an effect.
function subscribe(onChange: () => void) {
  const o = new MutationObserver(onChange);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-pref"] });
  return () => o.disconnect();
}
const readPref = () => parseThemePref(document.documentElement.getAttribute("data-theme-pref"));

/** The current preference, live (the rail footer's "Theme · Light"). */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, readPref, () => DEFAULT_THEME_PREF);
}

export const THEME_LABEL = LABEL;

export function ThemeSwitch({ className }: { className?: string }) {
  const pref = useThemePref();
  return (
    <fieldset className={`flex items-center gap-3 border-0 p-0${className ? ` ${className}` : ""}`}>
      <legend className="t-label-caps float-left mr-2 text-bp-ink-tertiary">Theme</legend>
      {/* Dark and System are hidden until K5 (lib/theme.ts THEME_CHOICES_OPEN). */}
      {OFFERED_THEME_PREFS.map((p) => (
        <label key={p} className="t-nav-item flex cursor-pointer items-center gap-1 text-bp-ink-secondary has-[:checked]:font-semibold has-[:checked]:text-bp-ink-primary">
          <input
            type="radio"
            name="bp-theme"
            value={p}
            checked={pref === p}
            onChange={() => setThemePreference(p)}
            className="accent-[var(--color-active-brass)]"
          />
          {LABEL[p]}
        </label>
      ))}
    </fieldset>
  );
}
