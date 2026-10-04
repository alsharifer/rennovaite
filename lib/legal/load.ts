// Reads a legal document from content/legal/ (H6). Server-only: the pages are
// statically rendered, so this runs at build time and the Markdown file is the
// one place the text lives.

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseLegalDocument, type LegalDocument } from "./markdown";

export type LegalDocumentKey = "privacy" | "terms";

export function loadLegalDocument(key: LegalDocumentKey): LegalDocument {
  return parseLegalDocument(readFileSync(path.join(process.cwd(), "content", "legal", `${key}.md`), "utf8"));
}
