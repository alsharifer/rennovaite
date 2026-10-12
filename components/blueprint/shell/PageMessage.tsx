// =============================================================================
// components/blueprint/shell/PageMessage.tsx — Not found / no access / error
// (K8 #11, spec §6.8, Figma 63:1175). One layout: an icon, the heading, what
// it means, a Primary action and "Contact support" (the help drawer on this
// page, ?help=1), and for an error its reference code in label/md — the
// server-log key, never a stack trace. Rendered inside the shell, so the rail
// of the context the reader was in stays on screen.
// =============================================================================

import type { ReactNode } from "react";

import { Button } from "../Button";
import { Icon } from "../Icon";

export function PageMessage({ icon, title, children, action, refCode }: { icon: string; title: string; children: ReactNode; action: ReactNode; refCode?: string }) {
  return (
    <div data-system="blueprint" className="mx-auto max-w-[1344px] px-6 pb-16 pt-20 lg:px-12" data-page-message>
      <Icon name={icon} className="text-[24px] text-bp-ink-secondary" />
      <h1 className="t-heading-lg mt-3 text-bp-ink-primary">{title}</h1>
      <div className="t-body-md mt-3 max-w-[560px] text-bp-ink-secondary">{children}</div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        {action}
        <Button kind="quiet" href="?help=1">
          Contact support
        </Button>
      </div>
      {refCode ? <p className="t-label-md mt-6 font-bp-mono text-bp-ink-tertiary">Reference {refCode}</p> : null}
    </div>
  );
}

/** Next's error digest as the reader quotes it to support. */
export const errorRef = (digest?: string) => (digest ? `ERR-${digest.slice(0, 10).toUpperCase()}` : undefined);
