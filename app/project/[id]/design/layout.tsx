import type { ReactNode } from "react";

import { ProjectShell } from "@/components/blueprint/shell/ProjectShell";

// K2: the Blueprint chrome for this segment, in a layout so its loading.tsx and
// error.tsx render inside the shell (the rail and top bar stay).
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProjectShell projectId={id} content="blueprint">
      {children}
    </ProjectShell>
  );
}
