import type { ReactNode } from "react";

import { AccountShell } from "@/components/blueprint/shell/ProjectShell";

// K2: the firm book and quote review in the Blueprint chrome, with this firm in
// the rail's firm switcher. In a project's context the same book is step 04 at
// /project/[id]/rates.
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  return (
    <AccountShell firmId={firmId} content="blueprint">
      {children}
    </AccountShell>
  );
}
