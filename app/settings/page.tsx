import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import Link from "next/link";

import { signOut } from "@/app/_actions/sign-out";
import { Button } from "@/components/blueprint/Button";
import { ThemeSwitch } from "@/components/blueprint/ThemeSwitch";
import { getPageCaller } from "@/lib/auth/caller";
import { listFirms } from "@/lib/firms/store";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const metadata: Metadata = { title: "Settings · RenovAIte" };
export const dynamic = "force-dynamic";

// K2 (spec §3.10): minimal settings — Account (e-mail, sign out) · Appearance
// (Light / Dark / System) · Firm (a link to each firm's book: OH&P, branding).
export default async function SettingsPage() {
  const caller = await getPageCaller();
  const firms = caller ? await listFirms(getSupabaseAdmin() as unknown as SupabaseClient, caller).catch(() => []) : [];

  return (
    <div className="mx-auto max-w-[720px] p-4 md:p-12">
      <h1 className="t-heading-lg mb-8">Settings</h1>

      <section aria-labelledby="settings-account" className="border-t border-bp-line-hairline py-6">
        <h2 id="settings-account" className="t-label-caps mb-3 text-bp-ink-tertiary">
          Account
        </h2>
        <p className="t-body-md">{caller?.email ?? "Signed in"}</p>
        <p className="t-body-sm mt-1 text-bp-ink-secondary">You sign in with a one-time link sent to this address — there is no password.</p>
        <form action={signOut} className="mt-4">
          <Button kind="secondary" type="submit">
            Sign out
          </Button>
        </form>
      </section>

      <section aria-labelledby="settings-appearance" className="border-t border-bp-line-hairline py-6">
        <h2 id="settings-appearance" className="t-label-caps mb-3 text-bp-ink-tertiary">
          Appearance
        </h2>
        <ThemeSwitch />
      </section>

      <section aria-labelledby="settings-firm" className="border-t border-bp-line-hairline py-6">
        <h2 id="settings-firm" className="t-label-caps mb-3 text-bp-ink-tertiary">
          Firm
        </h2>
        {firms.length === 0 ? (
          <p className="t-body-sm text-bp-ink-secondary">
            You are not a member of a firm.{" "}
            <Link href="/firms" className="underline">
              Create one
            </Link>{" "}
            to keep a private rate book.
          </p>
        ) : (
          <ul className="space-y-2">
            {firms.map((f) => (
              <li key={f.id}>
                <Link href={`/firms/${f.id}`} className="t-nav-item-active underline">
                  {f.name}
                </Link>
                <span className="t-body-sm text-bp-ink-secondary"> — rate book, OH&amp;P and proposal branding</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
