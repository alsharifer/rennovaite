import type { Metadata } from "next";

import { AuthForm } from "./_components/auth-form";

export const metadata: Metadata = {
  title: "Sign in · RennovAIte",
};

// Placeholder per spec (Unsplash query: walnut brass detail interior dubai).
// Swap for a licensed brand asset before launch. The right panel has a Bone
// base so the layout holds even if this URL ever fails.
const DETAIL_IMG =
  "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1100&q=80";

export default function AuthPage() {
  return (
    <main className="flex min-h-screen bg-background">
      {/* Left — form */}
      <section className="flex w-full flex-col items-center justify-center border-r border-ink-100 bg-canvas px-margin md:w-1/2">
        <AuthForm />
      </section>

      {/* Right — editorial imagery */}
      <section className="relative hidden h-screen items-center justify-center bg-background p-gutter md:flex md:w-1/2">
        <div className="matte-image h-full w-full overflow-hidden shadow-level-1">
          <div className="relative h-full w-full overflow-hidden rounded-lg bg-bone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={DETAIL_IMG}
              alt="Brass and walnut joinery detail in a Dubai villa interior"
              className="h-full w-full object-cover contrast-[1.05] sepia-[0.1] grayscale-[0.2]"
            />
            <div
              className="pointer-events-none absolute inset-0 bg-primary/5"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Floating editorial label */}
        <div className="absolute bottom-12 right-12 border border-ink-100 bg-paper/90 px-md py-sm backdrop-blur-sm">
          <p className="label-caps text-ink-900">Studio archive no. 042</p>
          <p className="mt-1 font-mono text-[10px] uppercase text-ink-500">
            Brass &amp; Walnut joinery detail
          </p>
        </div>
      </section>
    </main>
  );
}
