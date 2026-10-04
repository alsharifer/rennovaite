import type { Metadata } from "next";

import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";
import { PrivacyPlaceholder, PRIVACY_PLACEHOLDER_METADATA } from "@/components/legal/LegalPlaceholders";
import { loadLegalDocument } from "@/lib/legal/load";

// H6: the text is content/legal/privacy.md. It renders only once that file says
// `status: published` (counsel's approved text); until then the page is the
// "being finalised" placeholder. Publishing is a file swap + the status line.
export const dynamic = "force-static";

const doc = loadLegalDocument("privacy");
const published = doc.meta.status === "published";

export const metadata: Metadata = published
  ? legalMetadata(doc, "How RennovAIte collects, uses and protects your data.")
  : PRIVACY_PLACEHOLDER_METADATA;

export default function PrivacyPage() {
  return published ? <LegalPage doc={doc} /> : <PrivacyPlaceholder />;
}
