// =============================================================================
// lib/documents/doc-fonts.ts — the typefaces every server-rendered document prints
// in (K9; K8 review ruling 1, 13 Oct).
//
// resvg — the rasteriser behind the BoQ PDF, the proposal, the revision diff,
// the drawing set and the render pack — reads TTF/OTF only, and the app
// self-hosts woff2 (app/fonts), so until K9 every document fell back to
// whatever the server had (Arial / Consolas / Georgia at best). The OFL TTFs
// in lib/documents/fonts/ (origins + sha256 in SOURCES.json, licences beside
// them) are loaded here: IBM Plex Sans 300–600, JetBrains Mono 400–600,
// EB Garamond 400–500. System fonts stay loaded as the fallback for glyphs
// these do not cover (Arabic room names).
//
// The files are read from disk at render time, so next.config.ts traces
// lib/documents/fonts/** into every route that renders a document.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

export const DOCUMENT_FONT_DIR = path.join(process.cwd(), "lib", "documents", "fonts");

/** The TTF files, as absolute paths (sorted, so every render loads them in one order). */
export function documentFontFiles(): string[] {
  try {
    return fs
      .readdirSync(DOCUMENT_FONT_DIR)
      .filter((f) => f.toLowerCase().endsWith(".ttf"))
      .sort()
      .map((f) => path.join(DOCUMENT_FONT_DIR, f));
  } catch {
    return []; // fonts not traced into this function: the system fallback still renders
  }
}

/** resvg's `font` option for a document page. */
export function documentFontOptions() {
  return {
    fontFiles: documentFontFiles(),
    loadSystemFonts: true,
    defaultFontFamily: "IBM Plex Sans",
    sansSerifFamily: "IBM Plex Sans",
    serifFamily: "EB Garamond",
    monospaceFamily: "JetBrains Mono",
  };
}
