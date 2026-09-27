import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

// Fonts are SELF-HOSTED (app/fonts/, see SOURCES.json): the exact woff2 files
// next/font/google used to fetch from fonts.gstatic.com at build time, for the
// same declared subsets (latin / arabic) and weights. Nothing here reaches the
// network at build time. Google serves EB Garamond, Inter, JetBrains Mono and
// Rubik as one variable file per weight range; IBM Plex Sans Arabic is static.

// Display / headings — EB Garamond (latin, 400–700).
const ebGaramond = localFont({
  src: "./fonts/eb-garamond-latin.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-eb-garamond",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

// UI / body — Inter (latin, 400–700).
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
  title: "RennovAIte — AI villa renovation, Dubai",
  description:
    "AI-powered villa renovation, from floorplan to finished home in 5 days.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ebGaramond.variable} ${inter.variable} ${jetbrainsMono.variable} ${ibmPlexArabic.variable} ${rubik.variable} h-full antialiased`}
    >
      <head>
        {/* Material Symbols Outlined — Stitch shipped Material Symbols for
            every icon, so we follow that (DESIGN.md mentions Phosphor;
            ignored deliberately). */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
