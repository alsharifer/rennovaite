import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ICONS_READY_SCRIPT } from "@/lib/icons/ready";
import { THEME_NO_FLASH_SCRIPT } from "@/lib/theme";

import { Providers } from "./providers";

// Fonts are SELF-HOSTED (app/fonts/, see SOURCES.json): the exact woff2 files
// next/font/google used to fetch from fonts.gstatic.com at build time, for the
// same declared subsets (latin / arabic) and weights. Nothing here reaches the
// network at build time. Google serves EB Garamond, IBM Plex Sans and
// JetBrains Mono as one variable file per weight range; IBM Plex Sans Arabic is
// static. K10: Inter and Rubik are gone — nothing routed used them (Plex Sans
// is the base face, Plex Sans Arabic the Arabic one).

// Display / headings — EB Garamond (latin, 400–700).
const ebGaramond = localFont({
  src: "./fonts/eb-garamond-latin.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-eb-garamond",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

// Blueprint UI face — IBM Plex Sans (latin, 400–600; one variable file). Read
// through tokens.css's --font-sans inside [data-system="blueprint"] only.
const plexSans = localFont({
  src: "./fonts/ibm-plex-sans-latin.woff2",
  weight: "400 600",
  style: "normal",
  variable: "--font-plex-sans",
  display: "swap",
});

// Numerics / data — JetBrains Mono (latin, 400–700; 400 / 500 / 700 are used).
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Arabic fallbacks so RTL works without rework later (arabic subset only).
const ibmPlexArabic = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-arabic-400-arabic.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-500-arabic.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-600-arabic.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-arabic-700-arabic.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-ibm-plex-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RenovAIte — AI villa renovation, Dubai",
  description:
    "AI-powered villa renovation, from floorplan to finished home in 5 days.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Theme (K1 review): the pre-paint inline script below is the ONLY thing that
  // sets <html data-theme> — it reads the rv_theme cookie in the browser. The
  // layout never reads a cookie, so static pages stay static (spec §1.8's
  // server-side read is superseded). Only Blueprint surfaces read data-theme.
  return (
    <html
      lang="en"
      // The no-flash script sets data-theme before React hydrates.
      suppressHydrationWarning
      className={`${ebGaramond.variable} ${plexSans.variable} ${jetbrainsMono.variable} ${ibmPlexArabic.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
        {/* Material Symbols SHARP — the one icon font (R7 §1.6), self-hosted since K10:
            a subset of the icons the app draws (public/fonts, lib/icons/subset.json),
            preloaded; @font-face in app/globals.css with font-display: block. The
            script marks <html data-icons="ready"> once the font is in, and the icons
            stay transparent until then — their ligature text is never seen. */}
        <link rel="preload" href="/fonts/material-symbols-sharp.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: ICONS_READY_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
