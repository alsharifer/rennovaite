import Link from "next/link";

/** What a signed-out visitor sees on a members-only page (U2). */
export function SignInCard({ what }: { what: string }) {
  return (
    <section className="rounded-xl border border-ink-100 bg-paper p-lg" aria-label="Sign in required">
      <p className="label-caps text-ink-500">Members only</p>
      <h2 className="mt-xs font-display text-headline-md text-ink-900">Sign in to see {what}</h2>
      <p className="mt-sm max-w-xl text-body-md text-ink-700">
        Rate books belong to firms, and a firm belongs to the accounts that are its members. Sign in with the email that was
        added to the firm.
      </p>
      <Link href="/auth" className="focus-ring mt-md inline-flex items-center gap-xs rounded-lg bg-brass-600 px-md py-sm text-body-sm font-semibold text-white">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          login
        </span>
        Sign in
      </Link>
    </section>
  );
}
