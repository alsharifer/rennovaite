"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function WatchDemoButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring flex h-[56px] items-center gap-sm rounded-lg border border-ink-100 bg-paper/50 px-lg font-body-sm text-body-sm text-ink-900 transition-all hover:bg-paper"
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          play_arrow
        </span>
        Watch the 3-minute demo
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent className="w-[92vw] max-w-[880px] border border-ink-100 bg-paper p-0 duration-200 sm:max-w-[880px]">
          <DialogTitle className="sr-only">
            RennovAIte product demo
          </DialogTitle>
          <DialogDescription className="sr-only">
            A three-minute walkthrough of the RennovAIte flow.
          </DialogDescription>
          <div className="flex aspect-video w-full items-center justify-center bg-ink-900 text-paper">
            <div className="flex flex-col items-center gap-md text-center">
              <span
                className="material-symbols-outlined text-[64px] text-brass-600"
                aria-hidden="true"
              >
                play_circle
              </span>
              <p className="font-body-sm text-body-sm text-paper/70">
                Demo video coming soon
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
