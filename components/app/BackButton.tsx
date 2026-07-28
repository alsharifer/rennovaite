"use client";

import { useRouter } from "next/navigation";

/** Universal back control, rendered in the TopBar so every in-app page has one. */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      title="Back"
      className="focus-ring flex size-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-ink-900"
    >
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
        arrow_back
      </span>
    </button>
  );
}
