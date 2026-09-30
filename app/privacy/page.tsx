import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";
import { loadLegalDocument } from "@/lib/legal/load";

// H6: the text is content/legal/privacy.md (counsel's draft, verbatim). It is
// replaced by the lawyer-approved version by swapping that file.
export const dynamic = "force-static";

const doc = loadLegalDocument("privacy");

export const metadata = legalMetadata(doc, "How RennovAIte collects, uses and protects your data.");

export default function PrivacyPage() {
  return <LegalPage doc={doc} />;
}
