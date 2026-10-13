import type { ReactNode } from "react";

import { ProjectShell } from "@/components/blueprint/shell/ProjectShell";

// K2 / K4: the Blueprint chrome for this segment, in a layout so its
// loading.tsx and error.tsx render inside the shell (the rail and top bar
// stay). 06 Documents is a Blueprint body since K4.
export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ProjectShell projectId={id}>
      {children}
    </ProjectShell>
  );
}
