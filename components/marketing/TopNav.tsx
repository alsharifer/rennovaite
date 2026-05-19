"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS = [
  { label: "Floorplans", href: "/project" },
  { label: "AI Renders", href: "/project" },
  { label: "Marketplace", href: "/marketplace" },
];

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
        href="/"
        className="font-display text-headline-md text-primary tracking-tight"
      >
        RennovAIte
      </Link>

      <div className="flex items-center gap-xl">
        <div className="hidden items-center gap-lg md:flex">
          {LINKS.map((l, i) => (
            <Link
              key={`${l.label}-${i}`}
              href={l.href}
              className="font-label-caps text-label-caps uppercase text-on-surface-variant transition-colors hover:text-primary"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <Link
          href="/project"
          className="flex h-[48px] items-center rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm text-white transition-all hover:brightness-110 active:scale-[0.98]"
        >
          Start a project
        </Link>
      </div>
    </nav>
  );
}
