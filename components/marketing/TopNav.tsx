"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Invite-only pilot (front door, 13 Oct): every link here leads to the sign-in
// page. The section links into the app (Floorplans, AI Renders → /project) are
// gone — signed out they only bounced through /auth. A public landing can bring
// them back.
export function TopNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={[
        "fixed left-0 top-0 z-50 flex h-16 w-full items-center justify-between px-margin transition-all duration-300",
        scrolled
          ? "bg-paper/90 backdrop-blur-md border-b border-ink-100"
          : "bg-transparent border-b border-transparent",
      ].join(" ")}
    >
      <Link
        href="/auth"
        className="font-display text-headline-md text-primary tracking-tight"
      >
        RenovAIte
      </Link>

      <Link
        href="/auth"
        className="flex h-[48px] items-center rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm text-white transition-all hover:brightness-110 active:scale-[0.98]"
      >
        Sign in
      </Link>
    </nav>
  );
}
