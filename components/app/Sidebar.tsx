"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  icon: string; // Material Symbols name
  /** Pathname prefixes that mark this item active. */
  match: string[];
};

const PRIMARY: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard", match: ["/dashboard"] },
  { label: "AI Designer", href: "/project", icon: "magic_button", match: ["/project"] },
  {
    label: "My Projects",
    href: "/my-projects",
    icon: "folder_open",
    match: ["/my-projects"],
  },
  {
    label: "Marketplace",
    href: "/marketplace",
    icon: "storefront",
    match: ["/marketplace"],
  },
  { label: "Community", href: "/community", icon: "groups", match: ["/community"] },
];

const SECONDARY: NavItem[] = [
  { label: "Settings", href: "/settings", icon: "settings", match: ["/settings"] },
  { label: "Support", href: "/support", icon: "help", match: ["/support"] },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.match.some(
    (m) => pathname === m || pathname.startsWith(`${m}/`),
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={[
        "relative flex items-center gap-md py-md pl-lg pr-md transition-colors duration-200",
        active
          ? "border-l-4 border-brass-600 pl-[20px] text-ink-900 font-semibold"
          : "border-l-4 border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-ink-900",
      ].join(" ")}
    >
      <span
        className="material-symbols-outlined text-[22px]"
        aria-hidden="true"
        style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
      >
        {item.icon}
      </span>
      <span className="font-label-caps text-label-caps uppercase">
        {item.label}
      </span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? "";

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-full w-60 flex-col bg-[#FBF7EE] py-lg">
      {/* Brand */}
      <div className="px-lg pb-xl">
        <Link
          href="/"
          className="font-display text-headline-md text-primary tracking-tight"
        >
          RennovAIte
        </Link>
        <p className="mt-xs font-body-sm text-body-sm text-on-surface-variant">
          Pro Plan
        </p>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-grow flex-col gap-xs">
        {PRIMARY.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item)}
          />
        ))}
      </nav>

      {/* Secondary nav */}
      <div className="mt-auto flex flex-col gap-xs pt-lg">
        {SECONDARY.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item)}
          />
        ))}
      </div>
    </aside>
  );
}
