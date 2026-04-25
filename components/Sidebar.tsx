"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: string; // Material Symbols outlined name
  isActive: (pathname: string) => boolean;
};

const PRIMARY: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "dashboard",
    isActive: (p) => p === "/dashboard",
  },
  {
    label: "AI Designer",
    href: "/project",
    icon: "auto_awesome",
    isActive: (p) => p === "/project",
  },
  {
    label: "My Projects",
    href: "/my-projects",
    icon: "architecture",
    isActive: (p) =>
      p === "/my-projects" || /^\/project\/[^/]+/.test(p),
  },
  {
    label: "Marketplace",
    href: "/marketplace",
    icon: "shopping_bag",
    isActive: (p) => p === "/marketplace",
  },
  {
    label: "Community",
    href: "/community",
    icon: "groups",
    isActive: (p) => p === "/community",
  },
];

const SECONDARY: NavItem[] = [
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
    isActive: (p) => p === "/settings",
  },
  {
    label: "Support",
    href: "/support",
    icon: "help",
    isActive: (p) => p === "/support",
  },
];

function NavLink({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const active = item.isActive(pathname);
  return (
    <Link
      href={item.href}
      className={cn(
        "p-3 mx-2 rounded-lg flex items-center gap-3 text-sm font-semibold transition-all",
        active
          ? "bg-slate-900 shadow-[inset_4px_4px_8px_#080c18,inset_-4px_-4px_8px_#1e293b] text-indigo-400"
          : "text-slate-500 hover:bg-slate-900/50 hover:shadow-[-2px_-2px_5px_#1e293b,2px_2px_5px_#080c18] hover:text-on-surface",
      )}
    >
      <span className="material-symbols-outlined">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="bg-slate-950 fixed left-0 top-0 h-screen w-64 z-40 flex flex-col py-6 pt-24 rounded-r-lg border-r border-slate-900 shadow-[5px_5px_15px_#080c18]">
      <div className="px-6 mb-6">
        <span className="text-2xl font-extrabold tracking-tight text-indigo-500 drop-shadow-[0_0_8px_rgba(99,102,241,0.4)]">
          RennovAIte
        </span>
        <p className="mt-1 text-label-sm text-slate-500">Pro Plan</p>
      </div>
      <div className="flex flex-col flex-1 gap-2">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
      <div className="mt-auto border-t border-slate-900 pt-4 flex flex-col gap-2">
        {SECONDARY.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </div>
    </aside>
  );
}
