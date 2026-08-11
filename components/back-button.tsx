"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// Routes considered "top-level" — BackButton renders nothing on these.
const TOP_LEVEL = ["/", "/dashboard"];

// Where to land if there's no browser history (deep-link, hard refresh, etc.).
function computeFallback(pathname: string): string {
  if (pathname === "/project") return "/dashboard";
  // /project/[id]/<anything> → fall back to that project's plan page,
  // since there's no project-level dashboard yet.
  const inner = pathname.match(/^\/project\/([^/]+)\/[^/]+/);
  if (inner) return `/project/${inner[1]}/plan`;
  if (/^\/project\/[^/]+$/.test(pathname)) return "/dashboard";
  return "/";
}

export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (TOP_LEVEL.includes(pathname)) return null;

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(computeFallback(pathname));
    }
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className="-ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-text-secondary transition-colors hover:bg-bg-elevated/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
    >
      <ChevronLeft className="size-4" />
      Back
    </button>
  );
}
