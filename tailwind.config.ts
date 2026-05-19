import type { Config } from "tailwindcss";

/**
 * Atelier Precise — design system tokens.
 *
 * Loaded by app/globals.css via `@config "../tailwind.config.ts";` (Tailwind
 * v4 legacy-config bridge). The colors block is copied verbatim from
 * design-refs/stitch_rennovaite_design_system/landing_page/code.html plus the
 * editorial aliases (ink-*, brass-600, bone, canvas, paper). Standard Tailwind
 * scales (slate, etc.) are preserved because everything lives under `extend`.
 *
 * Font families resolve to the next/font CSS variables wired in
 * app/layout.tsx, with Arabic fallbacks appended so RTL works without rework.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- Material Design 3 set (from Stitch landing_page config) -------
        "on-error": "#ffffff",
        "tertiary-fixed-dim": "#ffb59e",
        "tertiary-container": "#bd5533",
        "on-secondary-fixed-variant": "#3c475b",
        "on-secondary": "#ffffff",
        "surface-container-low": "#f7f3ec",
        "outline-variant": "#d3c4b4",
        "on-background": "#1c1c18",
        "error-container": "#ffdad6",
        "on-primary-fixed-variant": "#624003",
        error: "#ba1a1a",
        "secondary-fixed-dim": "#bbc7df",
        "on-surface": "#1c1c18",
        "inverse-on-surface": "#f4f0e9",
        secondary: "#535f74",
        "secondary-fixed": "#d7e3fc",
        "surface-container-high": "#ebe8e1",
        "on-secondary-fixed": "#101c2e",
        "on-primary": "#ffffff",
        "surface-container-highest": "#e6e2db",
        "inverse-primary": "#f1be78",
        background: "#fdf9f2",
        "primary-container": "#966d2f",
        "tertiary-fixed": "#ffdbd0",
        surface: "#fdf9f2",
        primary: "#7a5518",
        tertiary: "#9d3e1d",
        "surface-bright": "#fdf9f2",
        "surface-container": "#f1ede6",
        "secondary-container": "#d4e0f9",
        "surface-container-lowest": "#ffffff",
        "surface-tint": "#7d571b",
        "on-primary-fixed": "#291800",
        "on-primary-container": "#fffbff",
        "primary-fixed-dim": "#f1be78",
        "on-secondary-container": "#576378",
        "on-tertiary-fixed-variant": "#802909",
        "on-tertiary": "#ffffff",
        "on-tertiary-fixed": "#3a0b00",
        "inverse-surface": "#31302c",
        "surface-dim": "#dddad3",
        "on-error-container": "#93000a",
        "on-tertiary-container": "#fffbff",
        "on-surface-variant": "#4f4539",
        "primary-fixed": "#ffddb3",
        "surface-variant": "#e6e2db",
        outline: "#817567",
        // --- Editorial aliases (semantic) ---------------------------------
        "ink-900": "#0F1B2D",
        "ink-700": "#334155",
        "ink-500": "#64748b",
        "ink-100": "#e2e8f0",
        "brass-600": "#A4793A",
        bone: "#EDE6D8",
        canvas: "#F7F3EC",
        paper: "#FFFFFF",
        // --- shadcn/ui bridge — resolves to CSS vars in globals.css :root --
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        popover: "var(--popover)",
        "popover-foreground": "var(--popover-foreground)",
        "primary-foreground": "var(--primary-foreground)",
        "secondary-foreground": "var(--secondary-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        destructive: "var(--destructive)",
        "destructive-foreground": "var(--destructive-foreground)",
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        md: "0.75rem",
        xl: "1.5rem",
        full: "9999px",
      },
      spacing: {
        gutter: "24px",
        margin: "64px",
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "48px",
        "2xl": "64px",
        "3xl": "96px",
      },
      fontFamily: {
        // Semantic
        display: ["var(--font-eb-garamond)", "var(--font-rubik)", "serif"],
        serif: ["var(--font-eb-garamond)", "var(--font-rubik)", "serif"],
        sans: [
          "var(--font-inter)",
          "var(--font-ibm-plex-arabic)",
          "sans-serif",
        ],
        body: [
          "var(--font-inter)",
          "var(--font-ibm-plex-arabic)",
          "sans-serif",
        ],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
        data: ["var(--font-jetbrains-mono)", "monospace"],
        // Stitch per-token families (used across the reference HTML)
        "display-hero": [
          "var(--font-eb-garamond)",
          "var(--font-rubik)",
          "serif",
        ],
        "headline-lg": [
          "var(--font-eb-garamond)",
          "var(--font-rubik)",
          "serif",
        ],
        "headline-lg-mobile": [
          "var(--font-eb-garamond)",
          "var(--font-rubik)",
          "serif",
        ],
        "headline-md": [
          "var(--font-eb-garamond)",
          "var(--font-rubik)",
          "serif",
        ],
        "body-lg": [
          "var(--font-inter)",
          "var(--font-ibm-plex-arabic)",
          "sans-serif",
        ],
        "body-md": [
          "var(--font-inter)",
          "var(--font-ibm-plex-arabic)",
          "sans-serif",
        ],
        "body-sm": [
          "var(--font-inter)",
          "var(--font-ibm-plex-arabic)",
          "sans-serif",
        ],
        "label-caps": [
          "var(--font-inter)",
          "var(--font-ibm-plex-arabic)",
          "sans-serif",
        ],
        "data-mono": ["var(--font-jetbrains-mono)", "monospace"],
      },
      fontSize: {
        "display-hero": [
          "64px",
          { lineHeight: "72px", fontWeight: "400", letterSpacing: "-0.02em" },
        ],
        "headline-lg": [
          "40px",
          { lineHeight: "48px", fontWeight: "600", letterSpacing: "-0.01em" },
        ],
        "headline-lg-mobile": [
          "32px",
          { lineHeight: "40px", fontWeight: "600" },
        ],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-sm": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "data-mono": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "label-caps": [
          "12px",
          { lineHeight: "16px", fontWeight: "600", letterSpacing: "0.05em" },
        ],
      },
      boxShadow: {
        hairline: "inset 0 0 0 1px #e2e8f0",
        "level-1":
          "0 1px 2px rgba(15,27,45,0.04), 0 8px 24px rgba(15,27,45,0.04)",
        "level-2":
          "0 2px 4px rgba(15,27,45,0.06), 0 24px 48px rgba(15,27,45,0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
