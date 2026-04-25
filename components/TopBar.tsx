type Props = {
  pageName: string;
};

export function TopBar({ pageName }: Props) {
  return (
    <header className="bg-slate-950 fixed top-0 left-0 right-0 h-16 px-6 flex items-center justify-between z-50 shadow-[0_4px_6px_-1px_rgba(8,12,24,1)]">
      <div className="flex items-center gap-4">
        <span className="text-lg font-extrabold tracking-tight text-indigo-500 drop-shadow-[0_0_6px_rgba(99,102,241,0.4)]">
          RennovAIte
        </span>
        <span
          className="h-5 w-px bg-slate-800"
          aria-hidden="true"
        />
        <span className="text-label-md text-on-surface">{pageName}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative flex items-center gap-2 rounded-full border border-slate-800/50 bg-slate-900 px-4 py-1.5 shadow-[inset_2px_2px_4px_#080c18,inset_-2px_-2px_4px_#1e293b]">
          <span className="material-symbols-outlined text-lg text-slate-500">
            search
          </span>
          <input
            className="w-48 border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-slate-600"
            placeholder="Search inspiration..."
            type="text"
          />
        </div>
        <button
          type="button"
          className="text-slate-400 hover:text-indigo-300 transition-colors"
          aria-label="Notifications"
        >
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <button
          type="button"
          className="text-slate-400 hover:text-indigo-300 transition-colors"
          aria-label="Account"
        >
          <span className="material-symbols-outlined">account_circle</span>
        </button>
      </div>
    </header>
  );
}
