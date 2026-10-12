"use client";

// =============================================================================
// components/blueprint/boq/InspectorSheet.tsx — the inspector as a bottom
// sheet on touch widths (R7 §3.2 tablet 14:890 / phone 26:924, §4.2 #4).
//
// A native modal <dialog>: focus is trapped while it is open and Escape closes
// it (back to the row). Tablet opens at the HALF detent with the selected row
// still visible above it; the handle (a button — tap, Enter or drag) moves it
// to FULL and back. Phone is full height. Motion is 200 ms, off under
// prefers-reduced-motion (globals.css).
// =============================================================================

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

export function InspectorSheet({ open, phone, onClose, children }: { open: boolean; phone: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detent, setDetent] = useState<"half" | "full">("half");
  const drag = useRef<{ y: number } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setDetent("half");
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const down = (e: PointerEvent) => {
    drag.current = { y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const up = (e: PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y;
    drag.current = null;
    if (dy < -40) setDetent("full");
    else if (dy > 160 && detent === "half") onClose();
    else if (dy > 40) setDetent("half");
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="bp-boq-inspector-heading"
      data-detent={phone ? "full" : detent}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="bp-boq-sheet bp-sheet fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none overflow-hidden border-t border-bp-line-strong bg-bp-surface-base p-0 text-bp-ink-primary"
      data-inspector-sheet=""
    >
      <div className="flex h-full flex-col">
        {phone ? null : (
          <button
            type="button"
            onPointerDown={down}
            onPointerUp={up}
            onClick={() => setDetent((d) => (d === "half" ? "full" : "half"))}
            aria-label={detent === "half" ? "Expand the inspector to full height" : "Shrink the inspector to half height"}
            className="flex h-6 w-full shrink-0 touch-none items-center justify-center"
          >
            <span className="block h-1 w-10 bg-bp-line-strong" aria-hidden="true" />
          </button>
        )}
        <div className="min-h-0 flex-1">{open ? children : null}</div>
      </div>
    </dialog>
  );
}

/** true at widths where the inspector is a sheet (< 1024 CSS px) — layout by CSS px, so zoom counts (§4.2 #11). */
export function useSheetLayout(): { sheet: boolean; phone: boolean } {
  const [state, setState] = useState({ sheet: false, phone: false });
  useEffect(() => {
    const tablet = window.matchMedia("(max-width: 1023.98px)");
    const phone = window.matchMedia("(max-width: 767.98px)");
    const update = () => setState({ sheet: tablet.matches, phone: phone.matches });
    update();
    tablet.addEventListener("change", update);
    phone.addEventListener("change", update);
    return () => {
      tablet.removeEventListener("change", update);
      phone.removeEventListener("change", update);
    };
  }, []);
  return state;
}
