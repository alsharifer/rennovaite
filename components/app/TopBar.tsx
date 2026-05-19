type Props = {
  pageName: string;
};

export function TopBar({ pageName }: Props) {
  return (
    <header className="fixed left-60 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-outline-variant bg-surface-bright px-lg">
      {/* Left: wordmark · bone divider · page name */}
      <div className="flex items-center gap-md">
        <span className="font-display text-headline-md text-primary tracking-tight">
          RennovAIte
        </span>
        <span
          className="h-6 w-px bg-bone"
          aria-hidden="true"
        />
        <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">
          {pageName}
        </span>
      </div>

      {/* Right: search pill · notifications · avatar */}
      <div className="flex items-center gap-lg">
        <div className="hidden items-center gap-sm rounded-full bg-surface-container-low px-md py-xs text-on-surface-variant md:flex">
          <span
            className="material-symbols-outlined text-[20px]"
            aria-hidden="true"
          >
            search
          </span>
          <span className="font-body-sm text-body-sm">Search…</span>
        </div>
        <button
          type="button"
          aria-label="Notifications"
          className="material-symbols-outlined text-on-surface-variant transition-colors hover:text-primary focus-ring"
        >
          notifications
        </button>
        <div
          className="flex size-8 items-center justify-center rounded-full bg-primary text-on-primary"
          aria-hidden="true"
        >
          <span className="material-symbols-outlined text-[20px]">person</span>
        </div>
      </div>
    </header>
  );
}
