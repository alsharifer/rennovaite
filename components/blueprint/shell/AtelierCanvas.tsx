// =============================================================================
// components/blueprint/shell/AtelierCanvas.tsx — an Atelier page body inside the
// Blueprint chrome (its own light canvas, Inter): the K8 transition until each
// page is rebuilt from its frame. The route scan
// (lib/__tests__/route-scan.test.ts) lists every page that still uses it; when
// that list is empty this file goes. `flush` drops the padding for
// edge-to-edge bodies (the render studio, the 3D view).
// =============================================================================

import type { ReactNode } from "react";

export function AtelierCanvas({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return (
    <div data-atelier className={`min-h-[calc(100vh-var(--bp-topbar-h))] bg-canvas font-sans text-on-background${flush ? "" : " p-4 md:p-12"}`}>
      {children}
    </div>
  );
}
