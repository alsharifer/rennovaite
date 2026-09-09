import type { Metadata } from "next";
import Link from "next/link";

import { Footer } from "@/components/marketing/Footer";
import { TopNav } from "@/components/marketing/TopNav";

export const metadata: Metadata = {
  title: "Terms — RennovAIte",
  description:
    "RennovAIte's terms of service are being finalised. Contact hello@rennovaite.fit in the meantime.",
};

// DELIBERATELY NOT TERMS OF SERVICE. See the note in app/privacy/page.tsx —
// same reasoning, same requirement that a qualified person drafts the real one.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="mx-auto max-w-[720px] px-margin py-3xl pt-32">
        <span className="label-caps text-brass-600 tracking-[0.2em]">Legal</span>
        <h1 className="mt-xs font-display text-headline-lg text-ink-900">
          Terms of service
        </h1>
        <p className="mt-lg font-body text-body-lg text-ink-700">
          Our terms of service are being finalised and are not published yet.
        </p>
        <p className="mt-md font-body text-body-md text-ink-700">
          Rather than publish untested wording, here is the commercial substance
          as it stands. For anything else, write to{" "}
          <a
            href="mailto:hello@rennovaite.fit"
            className="focus-ring text-brass-600 underline underline-offset-4"
          >
            hello@rennovaite.fit
          </a>
          .
        </p>
        <ul className="mt-lg flex list-disc flex-col gap-md pl-6 font-body text-body-md text-ink-700">
          <li>
            The project fee is <strong>AED 1,000</strong>, charged once when you
            lock a bill of quantities. It is not a subscription.
          </li>
          <li>
            It is credited in full against your project if you execute through
            the platform.
          </li>
          <li>
            RennovAIte produces a tender-ready package &mdash; designs, an
            itemised BoQ, drawings and a permit check. It does not carry out
            construction, and it is not a party to any contract you sign with a
            contractor.
          </li>
          <li>
            Rates are estimates drawn from supplier catalogues and real project
            quotations. Lines awaiting a quantity surveyor&rsquo;s review are
            flagged as such in the BoQ itself.
          </li>
        </ul>
        <Link
          href="/rennovaite"
          className="focus-ring mt-xl inline-flex font-body text-body-sm text-brass-600 hover:underline"
        >
          &larr; Back to RennovAIte
        </Link>
      </main>
      <Footer />
    </div>
  );
}
