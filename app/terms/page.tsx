import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";
import { loadLegalDocument } from "@/lib/legal/load";

// H6: the text is content/legal/terms.md (counsel's draft, verbatim). It is
// replaced by the lawyer-approved version by swapping that file.
export const dynamic = "force-static";

const doc = loadLegalDocument("terms");

export const metadata = legalMetadata(doc, "The terms that govern use of the RennovAIte platform.");

export default function TermsPage() {
  return <LegalPage doc={doc} />;
}
