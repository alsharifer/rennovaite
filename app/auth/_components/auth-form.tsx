"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

import { signInWithEmail } from "@/app/_actions/sign-in-with-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FADE = { duration: 0.24, ease: "easeOut" as const };

export function AuthForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("That doesn't look like a valid email.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await signInWithEmail(value);
      if (res.success) {
        setSubmittedTo(value);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setSubmittedTo(null);
    setError(null);
  }

  return (
    <div className="flex w-full max-w-[480px] flex-col items-start">
      {/* Wordmark */}
      <span className="mb-2xl font-display text-headline-md text-primary tracking-tight">
        RennovAIte
      </span>

      <AnimatePresence mode="wait" initial={false}>
        {submittedTo ? (
          <motion.div
            key="submitted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="w-full"
          >
            <h2 className="mb-md font-display text-headline-lg text-on-surface">
              Check your inbox.
            </h2>
            <p className="mb-xl font-body text-body-md leading-relaxed text-on-surface-variant">
              We sent a sign-in link to{" "}
              <span className="font-semibold text-on-surface">
                {submittedTo}
              </span>
              . It expires in 15 minutes.
            </p>
            <button
              type="button"
              onClick={reset}
              className="focus-ring flex h-12 w-full items-center justify-center rounded-lg border border-ink-100 font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container"
            >
              Use a different email
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="default"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="w-full"
          >
            <h1 className="mb-md font-display text-headline-lg text-on-surface">
              Pick up where you left off.
            </h1>
            <p className="mb-xl font-body text-body-md leading-relaxed text-on-surface-variant">
              Enter your email. We&apos;ll send a sign-in link — no password,
              no fuss.
            </p>

            <form onSubmit={onSubmit} className="w-full space-y-md" noValidate>
              <div className="flex w-full flex-col gap-xs">
                <label
                  htmlFor="email"
                  className="label-caps text-ink-500"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="architect@studio.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "email-error" : undefined}
                  className={[
                    "h-12 w-full rounded bg-paper px-md font-body-sm text-body-sm text-ink-900 outline-none transition-shadow duration-150 placeholder:text-outline-variant",
                    // Scoped transition (not transition-all): a broad
                    // border-color transition pins the computed value to its
                    // start under the base `* { border-color }` rule.
                    error
                      ? "border border-error focus:ring-1 focus:ring-error"
                      : "border border-ink-100 focus:border-brass-600 focus:ring-1 focus:ring-brass-600",
                  ].join(" ")}
                />
                {error && (
                  <p
                    id="email-error"
                    className="font-body-sm text-body-sm text-error"
                  >
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={pending}
                className="focus-ring flex h-12 w-full items-center justify-center rounded-lg bg-brass-600 font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary disabled:opacity-70"
              >
                {pending ? "Sending…" : "Send me the link"}
              </button>

              <p className="pt-sm font-body text-[12px] italic leading-relaxed text-on-surface-variant opacity-80">
                By continuing you agree to our Terms. We never share your
                floorplan.
              </p>
            </form>

            <div className="my-xl h-px w-full bg-bone" />

            <Link
              href="/project"
              className="focus-ring flex h-12 w-full items-center justify-center rounded-lg border border-ink-100 px-md text-center font-body-sm text-body-sm font-semibold text-ink-900 transition-colors hover:bg-surface-container"
            >
              Continue as a guest — your project will save for 7 days
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
