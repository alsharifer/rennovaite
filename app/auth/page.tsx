import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DesignViewVideo } from "@/components/blueprint/auth/DesignViewVideo";
import { SignInForm } from "@/components/blueprint/auth/SignInForm";
import { safeNextPath } from "@/lib/auth/access";
import { getPageCaller } from "@/lib/auth/caller";
import { SIGNED_IN_HOME, authErrorMessage } from "@/lib/auth/link-error";
import { loadLegalDocument } from "@/lib/legal/load";

export const metadata: Metadata = {
  title: "Sign in · RenovAIte",
};

// K6 — Sign in (R7 §3.9a, Figma 35:1152): Dark, shared by firm and owner — the
// one "futuristic" moment; everything after it stays practical. The right two
// thirds are a design view of a FICTIONAL villa captured from our own 3D stage
// (never a client project, never stock or AI imagery), poster first; the form
// sits left on a legibility gradient. On a phone the video is hidden and the
// poster is a 40%-height band above the form.
//
// H1: the proxy sends a signed-out visit here as /auth?next=<path>; the form
// carries it so the magic link returns the visitor where they were going.
// `error` is a failed sign-in link (lib/auth/link-error.ts) — said in words.
export default async function AuthPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Already signed in: never ask again — go where the visit was headed.
  if (await getPageCaller()) redirect(safeNextPath(next) ? next : SIGNED_IN_HOME);
  // H6: the legal pages say "being finalised" until counsel's text is published.
  const draft = (key: "privacy" | "terms") => {
    try {
      return loadLegalDocument(key).meta.status === "draft";
    } catch {
      return true;
    }
  };
  const legal = [
    { href: "/privacy", label: "Privacy", draft: draft("privacy") },
    { href: "/terms", label: "Terms", draft: draft("terms") },
  ];

  return (
    <main data-system="blueprint" data-theme="dark" className="relative min-h-screen overflow-hidden bg-bp-surface-base font-bp-sans text-bp-ink-primary">
      {/* Desktop / tablet: the design view, full bleed on the right two thirds. */}
      <div className="absolute inset-y-0 right-0 hidden w-2/3 md:block" aria-hidden="true">
        <DesignViewVideo className="h-full w-full object-cover" />
        <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[var(--color-surface-base)] to-transparent" />
      </div>
      <p className="t-label-caps absolute bottom-10 right-10 hidden border border-bp-line-hairline bg-bp-surface-sunken px-3 py-2 text-bp-ink-secondary md:block" aria-hidden="true">
        DESIGN VIEW · RENOVAITE 3D MODEL · ILLUSTRATIVE
      </p>

      {/* Phone: the poster as a band above the form. */}
      <div className="h-[40vh] w-full md:hidden" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static poster, decorative */}
        <img src="/design-view/villa-orbit-poster.webp" alt="" className="h-full w-full object-cover" />
      </div>

      <div className="relative z-10 flex min-h-[60vh] w-full flex-col px-6 py-10 md:min-h-screen md:max-w-[560px] md:px-24 md:py-24">
        <p className="t-heading-sm text-bp-ink-primary">RenovAIte</p>
        <div className="my-auto pt-10">
          <p className="t-label-caps text-bp-brass-text">SIGN IN</p>
          <h1 className="t-display-serif mt-4 text-bp-ink-primary">
            Renovation
            <br />
            Re-imagined
          </h1>
          <p className="t-body-md mt-5 max-w-[420px] text-bp-ink-secondary">Sign in with your email. We send a one-time link. No password to remember.</p>
          <div className="mt-8 max-w-[420px]">
            <SignInForm next={safeNextPath(next) ? next : undefined} linkError={authErrorMessage(error)} />
          </div>
        </div>
        <nav aria-label="Legal" className="mt-10 flex gap-6">
          {legal.map((l) => (
            <Link key={l.href} href={l.href} className="t-label-md inline-flex min-h-11 items-center whitespace-nowrap font-bp-mono text-bp-ink-secondary hover:text-bp-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring">
              {l.label}
              {l.draft ? " (being finalised)" : ""}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
