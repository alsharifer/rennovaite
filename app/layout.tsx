import type { Metadata } from "next";
import {
  EB_Garamond,
  Inter,
  JetBrains_Mono,
  IBM_Plex_Sans_Arabic,
  Rubik,
} from "next/font/google";
import "./globals.css";

// Display / headings — EB Garamond.
const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// UI / body — Inter.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Numerics / data — JetBrains Mono.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// Arabic fallbacks so RTL works without rework later.
const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-ibm-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "RennovAIte — coming soon to Dubai",
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
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
