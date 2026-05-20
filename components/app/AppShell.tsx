import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

type Props = {
  pageName: string;
  children: ReactNode;
  /**
   * Drop the default p-12 inner padding so the page can fill the content
   * area edge-to-edge (e.g. the three-column AI Designer workspace).
   * Defaults to false — existing pages keep their padded layout.
   */
  noPadding?: boolean;
};

/**
 * Atelier Precise in-app shell. Sidebar is a fixed 240px (w-60) left rail,
 * TopBar a fixed 64px (h-16) bar; the main column is offset by ml-60 pt-16
 * and scrolls independently on the canvas surface.
 */
export function AppShell({ pageName, children, noPadding = false }: Props) {
  return (
    <>
      <Sidebar />
      <TopBar pageName={pageName} />
      <div className="ml-60 min-h-screen bg-canvas pt-16">
        <div className={noPadding ? "" : "overflow-y-auto p-12"}>
          {children}
        </div>
      </div>
    </>
  );
}
