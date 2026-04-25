import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

type Props = {
  pageName: string;
  children: ReactNode;
};

export function AppShell({ pageName, children }: Props) {
  return (
    <>
      <TopBar pageName={pageName} />
      <Sidebar />
      <div className="ml-64 pt-16 min-h-screen bg-surface">
        <div className="overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
