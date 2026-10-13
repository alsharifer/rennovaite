"use client";

// =============================================================================
// components/blueprint/auth/SignInForm.tsx — the sign-in form (K6, R7 §3.9a,
// Figma 35:1152). Same flow as before (signInWithEmail → magic link; H5's
// invite-only notice is neutral — no account enumeration), in Blueprint:
// WORK EMAIL, "Email me a sign-in link", an inline invalid state
// (aria-invalid + described-by), the sent state with a resend after 30 s, and
// the invite-only line with Request access.
//
// K10: "Or enter the code from the email" — the e-mail carries a one-time code
// under its button (supabase/templates/magic-link.html). Typed here it is
// verified server-side (app/_actions/verify-email-code.ts), so sign-in works on
// any device and survives mail scanners that open the link first. Offered under
// the sent state (both the invited and the neutral invite-only answer — the
// form never says which addresses exist) and from the first screen ("I have a
// code") for a code read on another device. A wrong, expired or replaced code
// is one answer, in the inverse block like a failed link.
// =============================================================================

import { useEffect, useId, useState } from "react";

import { signInWithEmail } from "@/app/_actions/sign-in-with-email";
import { verifyEmailCode } from "@/app/_actions/verify-email-code";
import { normaliseCode } from "@/lib/auth/email-code";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER_S = 30;
const REQUEST_ACCESS = "mailto:hello@rennovaite.fit?subject=RenovAIte%20pilot%20access";

const FIELD = "h-12 w-full rounded-none border bg-bp-surface-raised px-3 t-body-md text-bp-ink-primary placeholder:text-bp-ink-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";
const PRIMARY = "inline-flex h-11 items-center px-4 t-nav-item-active whitespace-nowrap rounded-none bg-bp-ink-primary text-bp-ink-on-inverse hover:bg-bp-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";
const TEXT_LINK = "inline-flex min-h-11 items-center t-label-md text-bp-ink-primary underline decoration-bp-line-control underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";

/** The code from the e-mail — with the address when it is not already known (a code read on another device). */
function CodeEntry({ email: known, next }: { email: string | null; next?: string }) {
  const ids = useId();
  const [email, setEmail] = useState(known ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!EMAIL_RE.test(email.trim()) || !normaliseCode(code)) {
      setError("Enter your email and the code from the email.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await verifyEmailCode(email.trim(), code, next);
      // A full navigation, so the new session cookies ride on the next request.
      if (res.success) window.location.assign(res.to);
      else setError(res.error);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2" data-testid="code-entry">
      {known ? null : (
        <>
          <label htmlFor={`${ids}-cemail`} className="t-label-caps text-bp-ink-tertiary">
            WORK EMAIL
          </label>
          <input id={`${ids}-cemail`} type="email" autoComplete="email" inputMode="email" placeholder="name@yourfirm.ae" value={email} onChange={(e) => setEmail(e.target.value)} className={`${FIELD} mb-3 border-bp-line-control`} />
        </>
      )}
      <label htmlFor={`${ids}-code`} className="t-label-caps text-bp-ink-tertiary">
        CODE FROM THE EMAIL
      </label>
      <input
        id={`${ids}-code`}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={12}
        placeholder="Code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (error) setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${ids}-cerror` : undefined}
        className={`${FIELD.replace("t-body-md", "t-num-md")} ${error ? "border-bp-ink-primary" : "border-bp-line-control"}`}
        data-testid="code-input"
      />
      {error ? (
        <div id={`${ids}-cerror`} role="alert" className="surface-inverse mt-2 bg-bp-alert-surface px-4 py-3 text-bp-alert-ink" data-testid="code-error">
          <p className="t-body-sm">{error}</p>
        </div>
      ) : null}
      <div className="mt-3">
        <button type="submit" aria-disabled={pending} className={PRIMARY} data-testid="code-submit">
          {pending ? "Signing in…" : "Sign in with the code"}
        </button>
      </div>
    </form>
  );
}

export function SignInForm({ next, linkError }: { next?: string; linkError?: string | null }) {
  const [haveCode, setHaveCode] = useState(false);
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
              We sent a sign-in link and a code to <span className="text-bp-ink-primary">{sentTo}</span>. Both expire in 60 minutes; only the newest email works.
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
        <div className="mt-8 border-t border-bp-line-hairline pt-6">
          <h3 className="t-nav-item-active text-bp-ink-primary">Or enter the code from the email</h3>
          <p className="t-body-sm mt-1 mb-4 text-bp-ink-secondary">Works on any device — handy when the link opens on your phone.</p>
          <CodeEntry email={sentTo} next={next} />
        </div>
      </div>
    );
  }

  if (haveCode) {
    return (
      <div>
        <h2 className="t-heading-lg text-bp-ink-primary">Enter the code from the email</h2>
        <p className="t-body-md mt-3 mb-6 text-bp-ink-secondary">The email we sent has a code under the sign-in button.</p>
        <CodeEntry email={null} next={next} />
        <button type="button" onClick={() => setHaveCode(false)} className={`${TEXT_LINK} mt-4`}>
          Email me a new link instead
        </button>
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
      <button type="button" onClick={() => setHaveCode(true)} className={`${TEXT_LINK} mt-3`} data-testid="have-code">
        I have a code from the email
      </button>
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
