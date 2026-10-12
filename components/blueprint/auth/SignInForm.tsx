"use client";

// =============================================================================
// components/blueprint/auth/SignInForm.tsx — the sign-in form (K6, R7 §3.9a,
// Figma 35:1152). Same flow as before (signInWithEmail → magic link; H5's
// invite-only notice is neutral — no account enumeration), in Blueprint:
// WORK EMAIL, "Email me a sign-in link", an inline invalid state
// (aria-invalid + described-by), the sent state with a resend after 30 s, and
// the invite-only line with Request access.
// =============================================================================

import { useEffect, useId, useState } from "react";

import { signInWithEmail } from "@/app/_actions/sign-in-with-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER_S = 30;
const REQUEST_ACCESS = "mailto:hello@rennovaite.fit?subject=RenovAIte%20pilot%20access";

export function SignInForm({ next, linkError }: { next?: string; linkError?: string | null }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [wait, setWait] = useState(0);
  const ids = useId();

  // The resend countdown: one tick a second, from the moment a link was sent.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(value: string) {
    setPending(true);
    try {
      const res = await signInWithEmail(value, next);
      if (res.success) {
        setSentTo(value);
        setNotice(res.invited ? null : res.notice);
        setWait(RESEND_AFTER_S);
      } else setError(res.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Enter an email address like name@yourfirm.ae.");
      return;
    }
    setError(null);
    await send(value);
  }

  if (sentTo) {
    return (
      <div aria-live="polite" data-testid="sign-in-sent">
        {notice ? (
          <>
            <h2 className="t-heading-lg text-bp-ink-primary">Invite-only, for now</h2>
            <p className="t-body-md mt-3 text-bp-ink-secondary" data-testid="invite-only">
              {notice}
            </p>
          </>
        ) : (
          <>
            <h2 className="t-heading-lg text-bp-ink-primary">Check your inbox</h2>
            <p className="t-body-md mt-3 text-bp-ink-secondary">
              We sent a sign-in link to <span className="text-bp-ink-primary">{sentTo}</span>. The link expires in 15 minutes.
            </p>
          </>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => (wait > 0 || pending ? undefined : void send(sentTo))}
            aria-disabled={wait > 0 || pending}
            aria-describedby={wait > 0 ? `${ids}-wait` : undefined}
            className={`inline-flex h-11 items-center px-4 t-nav-item-active whitespace-nowrap rounded-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring ${wait > 0 || pending ? "border border-bp-line-hairline text-bp-ink-tertiary cursor-not-allowed" : "border border-bp-line-control text-bp-ink-primary hover:bg-bp-surface-sunken"}`}
            data-testid="resend"
          >
            {pending ? "Sending…" : "Send the link again"}
          </button>
          {wait > 0 ? (
            <span id={`${ids}-wait`} className="t-label-md text-bp-ink-tertiary">
              available in {wait} s
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setNotice(null);
              setError(null);
              setWait(0);
            }}
            className="inline-flex h-11 items-center t-label-md text-bp-ink-primary underline decoration-bp-line-control underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {linkError ? (
        <div role="status" data-testid="link-error" className="surface-inverse mb-6 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink">
          <p className="t-body-sm">{linkError}</p>
        </div>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
        <label htmlFor={`${ids}-email`} className="t-label-caps text-bp-ink-tertiary">
          WORK EMAIL
        </label>
        <input
          id={`${ids}-email`}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@yourfirm.ae"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids}-error` : undefined}
          className={`h-12 w-full rounded-none border bg-bp-surface-raised px-3 t-body-md text-bp-ink-primary placeholder:text-bp-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring ${error ? "border-bp-ink-primary" : "border-bp-line-control"}`}
        />
        {error ? (
          <p id={`${ids}-error`} className="t-body-sm text-bp-ink-primary">
            {error}
          </p>
        ) : null}
        <div className="mt-4">
          <button
            type="submit"
            aria-disabled={pending}
            className="inline-flex h-11 items-center px-4 t-nav-item-active whitespace-nowrap rounded-none bg-bp-ink-primary text-bp-ink-on-inverse hover:bg-bp-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring"
          >
            {pending ? "Sending…" : "Email me a sign-in link"}
          </button>
        </div>
      </form>
      <p className="t-label-md mt-6 font-bp-mono text-bp-ink-secondary">
        Invite-only during the pilot. Running a fit-out firm?{" "}
        <a href={REQUEST_ACCESS} className="text-bp-ink-primary underline decoration-bp-line-control underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring">
          Request access
        </a>
        .
      </p>
    </div>
  );
}
