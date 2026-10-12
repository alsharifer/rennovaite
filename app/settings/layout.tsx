import type { ReactNode } from "react";

import { AccountShell } from "@/components/blueprint/shell/ProjectShell";

export default function Layout({ children }: { children: ReactNode }) {
  return <AccountShell content="blueprint">{children}</AccountShell>;
}
