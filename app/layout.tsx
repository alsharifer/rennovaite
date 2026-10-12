import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";
import { THEME_COOKIE, THEME_NO_FLASH_SCRIPT, parseThemePref, serverTheme } from "@/lib/theme";

import { Providers } from "./providers";

// Fonts are SELF-HOSTED (app/fonts/, see SOURCES.json): the exact woff2 files
// next/font/google used to fetch from fonts.gstatic.com at build time, for the
// same declared subsets (latin / arabic) and weights. Nothing here reaches the
// network at build time. Google serves EB Garamond, IBM Plex Sans, Inter,
// JetBrains Mono and Rubik as one variable file per weight range; IBM Plex Sans
// Arabic is static.

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

// Atelier UI / body — Inter (latin, 400–700). Blueprint pages use Plex Sans.
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-inter",
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

const rubik = localFont({
  src: "./fonts/rubik-arabic.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-rubik",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RenovAIte — AI villa renovation, Dubai",
  description:
    "AI-powered villa renovation, from floorplan to finished home in 5 days.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // R7 §1.8: an explicit Light / Dark preference renders server-side; System
  // (and anything the cookie does not settle) is resolved by the inline script
  // before first paint. Only Blueprint surfaces read data-theme.
  const theme = serverTheme(parseThemePref((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html
      lang="en"
      data-theme={theme}
      // The no-flash script may set data-theme before React hydrates.
      suppressHydrationWarning
      className={`${ebGaramond.variable} ${plexSans.variable} ${inter.variable} ${jetbrainsMono.variable} ${ibmPlexArabic.variable} ${rubik.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
        {/* Material Symbols SHARP (variable) — the one icon font (R7 §1.6):
            Atelier's .material-symbols-outlined class at weight 400, Blueprint's
            <Icon> at 300 / opsz 20 (app/globals.css). */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- the App Router root layout loads on every page (the rule targets pages/_document) */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Sharp:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
