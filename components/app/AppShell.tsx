import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

type Props = {
  pageName: string;
  children: ReactNode;
};

/**
 * Atelier Precise in-app shell. Sidebar is a fixed 240px (w-60) left rail,
 * TopBar a fixed 64px (h-16) bar; the main column is offset by ml-60 pt-16
 * and scrolls independently on the canvas surface.
 */
export function AppShell({ pageName, children }: Props) {
  return (
    <>
      <Sidebar />
      <TopBar pageName={pageName} />
      <div className="ml-60 min-h-screen bg-canvas pt-16">
        <div className="overflow-y-auto p-12">{children}</div>
      </div>
    </>
  );
}
