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
          <div className="flex size-12 items-center justify-center rounded-full bg-primary-fixed text-brass-600">
            <span className="material-symbols-outlined text-2xl" aria-hidden="true">
              send
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-h3 text-on-surface">
              Ready to send
            </DialogTitle>
            <DialogDescription className="text-body-md text-on-surface-variant">
              We&apos;ll invite three vetted contractors to bid on this scope. You&apos;ll
              hear back within 3–5 business days with their quotes against this BoQ.
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
