// =============================================================================
// components/blueprint/legal/LegalPlaceholders.tsx — what /privacy and /terms
// show until counsel's text is approved (H6), in the K8 legal template
// (65:1480) under the inverse "DRAFT — BEING FINALISED WITH COUNSEL" band.
// The words are H6's placeholders, unchanged, grouped into sections. The page
// switches to the rendered document only when content/legal/<key>.md says
// `status: published` — so the working drafts (with their bracketed blanks)
// are never public.
//
// DELIBERATELY NOT A POLICY. Generating plausible-looking legal prose would be
// the same failure in a smarter costume: a reader cannot tell invented terms
// from reviewed ones.
// =============================================================================

import type { Metadata } from "next";

import { LEGAL_ROBOTS, LegalTemplate } from "./LegalTemplate";

const BAND = "DRAFT — BEING FINALISED WITH COUNSEL";

export const PRIVACY_PLACEHOLDER_METADATA: Metadata = {
  title: "Privacy — RenovAIte",
  robots: LEGAL_ROBOTS,
  description: "RenovAIte's privacy policy is being finalised. Contact hello@rennovaite.fit with any question about your data in the meantime.",
};

export const TERMS_PLACEHOLDER_METADATA: Metadata = {
  title: "Terms — RenovAIte",
  robots: LEGAL_ROBOTS,
  description: "RenovAIte's terms of service are being finalised. Contact hello@rennovaite.fit in the meantime.",
};

const Mail = () => (
  <a href="mailto:hello@rennovaite.fit" className="underline underline-offset-4">
    hello@rennovaite.fit
  </a>
);

export function PrivacyPlaceholder() {
  return (
    <LegalTemplate
      title="Privacy"
      band={BAND}
      sections={[
        { id: "where-things-stand", title: "1. Where things stand", body: <p>Our privacy policy is being finalised and is not published yet. We would rather say that than show you a page of text nobody has reviewed.</p> },
        {
          id: "what-we-can-tell-you",
          title: "2. What we can tell you today",
          body: <p>Floorplans, photographs and project details you upload are stored so the platform can produce your designs and bill of quantities. They are not sold, and they are not shared with contractors unless you choose to invite them to bid.</p>,
        },
        {
          id: "contact",
          title: "3. Contact",
          body: (
            <p>
              If you want to know what we hold about you, how it is stored, or you would like it deleted, write to <Mail /> and a person will answer.
            </p>
          ),
        },
      ]}
    />
  );
}

export function TermsPlaceholder() {
  return (
    <LegalTemplate
      title="Terms of service"
      band={BAND}
      sections={[
        { id: "where-things-stand", title: "1. Where things stand", body: <p>Our terms of service are being finalised and are not published yet. Rather than publish untested wording, here is the commercial substance as it stands.</p> },
        {
          id: "commercial-substance",
          title: "2. The commercial substance",
          body: (
            <ul className="list-disc space-y-1.5 pl-6">
              <li>
                The project fee is <strong className="font-semibold">AED 1,000</strong>, charged once when you lock a bill of quantities. It is not a subscription.
              </li>
              <li>It is credited in full against your project if you execute through the platform.</li>
              <li>RenovAIte produces a tender-ready package — designs, an itemised BoQ, drawings and a permit check. It does not carry out construction, and it is not a party to any contract you sign with a contractor.</li>
              <li>Rates are estimates drawn from supplier catalogues and real project quotations. Lines awaiting a quantity surveyor’s review are flagged as such in the BoQ itself.</li>
            </ul>
          ),
        },
        {
          id: "contact",
          title: "3. Contact",
          body: (
            <p>
              For anything else, write to <Mail />.
            </p>
          ),
        },
      ]}
    />
  );
}
