import type { Metadata } from "next";
import Link from "next/link";

import { Footer } from "@/components/marketing/Footer";
import { TopNav } from "@/components/marketing/TopNav";

export const metadata: Metadata = {
  title: "Privacy — RennovAIte",
  description:
    "RennovAIte's privacy policy is being finalised. Contact hello@rennovaite.fit with any question about your data in the meantime.",
};

// DELIBERATELY NOT A PRIVACY POLICY.
//
// The footer linked "Privacy Policy" to `#`, which is worse than an honest
// placeholder: it looks like a policy exists. This page says plainly that one
// does not yet, and gives a real address to ask.
//
// It must be replaced with text drafted by someone qualified — generating
// plausible-looking legal prose would be the same failure in a smarter costume,
// because a reader cannot tell invented terms from reviewed ones.
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="mx-auto max-w-[720px] px-margin py-3xl pt-32">
        <span className="label-caps text-brass-600 tracking-[0.2em]">Legal</span>
        <h1 className="mt-xs font-display text-headline-lg text-ink-900">
          Privacy
        </h1>
        <p className="mt-lg font-body text-body-lg text-ink-700">
          Our privacy policy is being finalised and is not published yet.
        </p>
        <p className="mt-md font-body text-body-md text-ink-700">
          We would rather say that than show you a page of text nobody has
          reviewed. If you want to know what we hold about you, how it is
          stored, or you would like it deleted, write to{" "}
          <a
            href="mailto:hello@rennovaite.fit"
            className="focus-ring text-brass-600 underline underline-offset-4"
          >
            hello@rennovaite.fit
          </a>{" "}
          and a person will answer.
        </p>
        <p className="mt-md font-body text-body-md text-ink-700">
          What we can tell you today: floorplans, photographs and project
          details you upload are stored so the platform can produce your designs
          and bill of quantities. They are not sold, and they are not shared
          with contractors unless you choose to invite them to bid.
        </p>
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
