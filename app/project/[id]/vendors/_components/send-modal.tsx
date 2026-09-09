"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function SendModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[92vw] max-w-[480px] border border-outline-variant bg-surface-container-high p-6 text-on-surface duration-200 sm:max-w-[480px]">
        <div className="flex flex-col gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-400">
            <span className="material-symbols-outlined text-2xl" aria-hidden="true">
              send
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-h3 text-on-surface">
              Your scope is ready to share
            </DialogTitle>
            <DialogDescription className="text-body-md text-on-surface-variant">
              Download the BoQ and drawings and send them to any contractor you
              choose &mdash; the package is built to be bid against as it
              stands. Inviting contractors from within the platform is a roadmap
              deliverable; we don&apos;t have a vetted panel to send this to yet.
            </DialogDescription>
          </div>
          <div className="mt-2 flex justify-end">
            <Button onClick={onClose}>Got it</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
