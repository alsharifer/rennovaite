"use client";

// =============================================================================
// ideation-flow.tsx — B1 guided questionnaire → recommended direction.
//
// One question at a time, answers autosaved as they are given, then a
// recommendation panel with sample imagery from the style system.
//
// The one rule that shapes the state here: the RECOMMENDATION and the user's
// OWN PICK are separate values. Re-running the recommendation recomputes the
// former and never touches the latter, so "try again" can never silently
// overwrite a decision someone made on purpose.
// =============================================================================

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";
import {
  QUESTIONS,
  briefProgress,
  type BriefAnswers,
  type Recommendation,
} from "@/lib/ideation/questionnaire";
import { STYLES, type Style } from "@/lib/styles";
import { cn } from "@/lib/utils";

export interface IdeationBrief {
  answers: BriefAnswers;
  recommended_style_key: string | null;
  override_style_key: string | null;
  recommendation: Partial<Recommendation> | null;
  completed_at: string | null;
}

type Props = {
  projectId: string;
  initialBrief: IdeationBrief | null;
  /** Where the journey goes next (moodboard), for the forward CTA. */
  nextHref: string;
  nextLabel: string;
  /** The full style grid lives on its own surface within this same step. */
  styleHref: string;
};

const styleByKey = new Map(STYLES.map((s) => [s.key, s]));

export function IdeationFlow({
  projectId,
  initialBrief,
  nextHref,
  nextLabel,
  styleHref,
}: Props) {
  const [answers, setAnswers] = useState<BriefAnswers>(initialBrief?.answers ?? {});
  const [recommended, setRecommended] = useState<string | null>(
    initialBrief?.recommended_style_key ?? null,
  );
  const [override, setOverride] = useState<string | null>(
    initialBrief?.override_style_key ?? null,
  );
  const [why, setWhy] = useState<string[]>(initialBrief?.recommendation?.why ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  const progress = useMemo(() => briefProgress(answers), [answers]);
  // Start on the first unanswered question so returning users resume in place.
  const [cursor, setCursor] = useState(() => {
    const seeded = initialBrief?.answers ?? {};
    const i = QUESTIONS.findIndex((q) => seeded[q.id] == null);
    return i === -1 ? QUESTIONS.length : i;
  });

  const reviewing = cursor >= QUESTIONS.length;
  const effectiveKey = override ?? recommended;
  const effective = effectiveKey ? (styleByKey.get(effectiveKey) ?? null) : null;
  const recommendedStyle = recommended ? (styleByKey.get(recommended) ?? null) : null;

  const save = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/project-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, ...payload }),
        });
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error ?? "Save failed.");
        // The server owns the recommendation — mirror what it decided rather
        // than recomputing client-side and risking a divergent answer.
        setRecommended(body.brief?.recommended_style_key ?? null);
        setOverride(body.brief?.override_style_key ?? null);
        setWhy(body.recommendation?.why ?? []);
        return body;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
        setDegraded(true);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  const answer = (questionId: string, optionId: string, multi: boolean) => {
    const current = answers[questionId];
    let next: string | string[];
    if (multi) {
      const list = Array.isArray(current) ? current : current ? [current] : [];
      next = list.includes(optionId)
        ? list.filter((x) => x !== optionId)
        : [...list, optionId];
    } else {
      next = optionId;
    }
    const merged = { ...answers, [questionId]: next };
    setAnswers(merged);
    void save({ answers: { [questionId]: next } });
    // Single-choice questions advance on pick; multi waits for "Continue".
    if (!multi) setTimeout(() => setCursor((c) => c + 1), 160);
  };

  const finish = async () => {
    const body = await save({ answers, complete: true });
    if (body) {
      track(AnalyticsEvent.StyleSelected, {
        project_id: projectId,
        style_key: body.brief?.recommended_style_key ?? "none",
      });
    }
    setCursor(QUESTIONS.length);
  };

  /** Recompute from the same answers. Never touches the manual override. */
  const rerun = async () => {
    await save({ answers });
  };

  const pickManually = async (key: string | null) => {
    setOverride(key);
    await save({ override_style_key: key });
    if (key) {
      // Keep the rest of the app (render, BoQ, drawings) on the chosen style.
      await fetch("/api/style-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, style_key: key }),
      }).catch(() => {});
    }
  };

  const confirm = async () => {
    if (!effectiveKey) return;
    await fetch("/api/style-choice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, style_key: effectiveKey }),
    }).catch(() => {});
  };

  return (
    <div className="space-y-xl">
      {degraded && (
        <p className="rounded-lg border border-ink-100 bg-surface-container px-lg py-md font-body-sm text-body-sm text-on-surface-variant">
          Answers aren&apos;t saving — the ideation table may not be applied yet
          (migration 027). You can still browse directions on the{" "}
          <Link href={styleHref} className="underline">
            style page
          </Link>
          .
        </p>
      )}

      {/* Progress ------------------------------------------------------ */}
      <div className="flex items-center gap-md">
        <div className="flex flex-1 gap-xs" aria-hidden="true">
          {QUESTIONS.map((q, i) => (
            <span
              key={q.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                answers[q.id] != null ? "bg-brass-600" : i === cursor ? "bg-bone" : "bg-ink-100",
              )}
            />
          ))}
        </div>
        <p className="font-mono text-data-mono tabular-nums text-ink-500">
          {progress.answered}/{progress.total}
        </p>
      </div>

      {!reviewing ? (
        <QuestionCard
          key={QUESTIONS[cursor]!.id}
          question={QUESTIONS[cursor]!}
          answers={answers}
          onAnswer={answer}
          onBack={cursor > 0 ? () => setCursor((c) => c - 1) : null}
          onContinue={() =>
            cursor === QUESTIONS.length - 1 ? void finish() : setCursor((c) => c + 1)
          }
          isLast={cursor === QUESTIONS.length - 1}
          busy={saving}
        />
      ) : (
        <RecommendationPanel
          effective={effective}
          recommendedStyle={recommendedStyle}
          isOverridden={!!override && override !== recommended}
          why={why}
          answeredCount={progress.answered}
          busy={saving}
          onRerun={() => void rerun()}
          onClearOverride={() => void pickManually(null)}
          onPick={(k) => void pickManually(k)}
          onEdit={() => setCursor(0)}
          onConfirm={() => void confirm()}
          nextHref={nextHref}
          nextLabel={nextLabel}
          styleHref={styleHref}
        />
      )}

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuestionCard({
  question,
  answers,
  onAnswer,
  onBack,
  onContinue,
  isLast,
  busy,
}: {
  question: (typeof QUESTIONS)[number];
  answers: BriefAnswers;
  onAnswer: (questionId: string, optionId: string, multi: boolean) => void;
  onBack: (() => void) | null;
  onContinue: () => void;
  isLast: boolean;
  busy: boolean;
}) {
  const multi = !!question.multi;
  const current = answers[question.id];
  const selected = new Set(
    Array.isArray(current) ? current : current ? [current] : [],
  );

  return (
    <section className="rounded-xl border border-ink-100 bg-paper p-xl">
      <h2 className="mb-xs font-display text-headline-md text-ink-900">
        {question.prompt}
      </h2>
      {question.hint && (
        <p className="mb-lg font-body text-body-sm text-on-surface-variant">
          {question.hint}
        </p>
      )}

      <ul className="grid gap-sm sm:grid-cols-2">
        {question.options.map((o) => {
          const on = selected.has(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onAnswer(question.id, o.id, multi)}
                className={cn(
                  "focus-ring flex w-full flex-col items-start gap-xs rounded-lg border p-lg text-left transition-all",
                  on
                    ? "border-2 border-brass-600 bg-surface-container-low"
                    : "border-ink-100 bg-paper hover:-translate-y-0.5 hover:shadow-level-1",
                )}
              >
                <span className="font-body text-body-md font-semibold text-ink-900">
                  {o.label}
                </span>
                {o.hint && (
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    {o.hint}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-xl flex items-center justify-between gap-md">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="focus-ring rounded-lg px-md py-sm font-body-sm text-body-sm text-ink-700 hover:bg-surface-container"
          >
            Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-md">
          {multi && (
            <p className="font-body-sm text-body-sm italic text-on-surface-variant">
              Pick as many as you like.
            </p>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={busy || selected.size === 0}
            className={cn(
              "focus-ring flex h-11 items-center gap-sm rounded-lg px-lg font-body-sm text-body-sm font-semibold transition-colors",
              selected.size > 0 && !busy
                ? "bg-brass-600 text-on-primary hover:bg-primary"
                : "cursor-not-allowed bg-brass-600/40 text-on-primary",
            )}
          >
            {isLast ? "See my direction" : "Continue"}
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function RecommendationPanel({
  effective,
  recommendedStyle,
  isOverridden,
  why,
  answeredCount,
  busy,
  onRerun,
  onClearOverride,
  onPick,
  onEdit,
  onConfirm,
  nextHref,
  nextLabel,
  styleHref,
}: {
  effective: Style | null;
  recommendedStyle: Style | null;
  isOverridden: boolean;
  why: string[];
  answeredCount: number;
  busy: boolean;
  onRerun: () => void;
  onClearOverride: () => void;
  onPick: (key: string) => void;
  onEdit: () => void;
  onConfirm: () => void;
  nextHref: string;
  nextLabel: string;
  styleHref: string;
}) {
  if (answeredCount === 0 || !effective) {
    return (
      <section className="rounded-xl border border-dashed border-ink-100 bg-paper p-2xl text-center">
        <p className="mb-sm font-display text-headline-md italic text-ink-900">
          Nothing to recommend yet.
        </p>
        <p className="mx-auto mb-lg max-w-[46ch] font-body text-body-md text-on-surface-variant">
          Answer a few questions and we&apos;ll suggest a direction — or browse
          all six and pick one yourself.
        </p>
        <div className="flex items-center justify-center gap-md">
          <button
            type="button"
            onClick={onEdit}
            className="focus-ring flex h-11 items-center rounded-lg bg-brass-600 px-lg font-body-sm text-body-sm font-semibold text-on-primary hover:bg-primary"
          >
            Start the questions
          </button>
          <Link
            href={styleHref}
            className="focus-ring flex h-11 items-center rounded-lg border border-ink-100 px-lg font-body-sm text-body-sm font-semibold text-ink-900 hover:bg-surface-container"
          >
            Browse all directions
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-lg">
      <section className="rounded-xl border border-ink-100 bg-paper p-xl">
        <div className="mb-lg flex flex-wrap items-center gap-sm">
          <p className="label-caps text-brass-600">
            {isOverridden ? "Your pick" : "Recommended for you"}
          </p>
          {isOverridden && recommendedStyle && (
            <span className="rounded-full border border-ink-100 px-sm py-0.5 font-body-sm text-body-sm text-on-surface-variant">
              We suggested {recommendedStyle.name_en}
              <button
                type="button"
                onClick={onClearOverride}
                className="ml-xs underline hover:text-ink-900"
              >
                use it instead
              </button>
            </span>
          )}
        </div>

        <h2 className="mb-xs font-display text-headline-lg text-ink-900">
          {effective.name_en}
        </h2>
        <p className="mb-lg max-w-[60ch] font-body text-body-lg text-on-surface-variant">
          {effective.one_line}
        </p>

        {/* Sample imagery straight from the style system. */}
        <ul className="mb-lg grid grid-cols-2 gap-sm sm:grid-cols-4">
          {effective.reference_images.map((src, i) => (
            <li key={src} className="matte-image overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`${effective.name_en} sample ${i + 1}`}
                className="aspect-square w-full rounded object-cover"
                loading="lazy"
              />
            </li>
          ))}
        </ul>

        {why.length > 0 && !isOverridden && (
          <div className="mb-lg rounded-lg bg-surface-container-low p-lg">
            <p className="label-caps mb-sm text-ink-500">Why this direction</p>
            <ul className="space-y-xs">
              {why.map((w) => (
                <li key={w} className="font-body-sm text-body-sm text-ink-700">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="mb-lg space-y-xs">
          {effective.what_changes.map((w) => (
            <li key={w} className="flex gap-sm font-body-sm text-body-sm text-ink-700">
              <span className="material-symbols-outlined text-[18px] text-brass-600" aria-hidden="true">
                check
              </span>
              {w}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            onClick={onRerun}
            disabled={busy}
            className="focus-ring flex h-10 items-center gap-xs rounded-lg border border-ink-100 px-md font-body-sm text-body-sm text-ink-900 hover:bg-surface-container disabled:opacity-50"
            title="Recompute from your answers. Your own pick is never overwritten."
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              refresh
            </span>
            Re-run recommendation
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="focus-ring flex h-10 items-center gap-xs rounded-lg border border-ink-100 px-md font-body-sm text-body-sm text-ink-900 hover:bg-surface-container"
          >
            Change my answers
          </button>
          <Link
            href={styleHref}
            className="focus-ring flex h-10 items-center gap-xs rounded-lg border border-ink-100 px-md font-body-sm text-body-sm text-ink-900 hover:bg-surface-container"
          >
            Compare all six
          </Link>
        </div>
      </section>

      {/* Override strip — pick a different direction without leaving. */}
      <section className="rounded-xl border border-ink-100 bg-paper p-lg">
        <p className="label-caps mb-md text-ink-500">Or choose another direction</p>
        <ul className="grid grid-cols-2 gap-sm sm:grid-cols-3 lg:grid-cols-6">
          {STYLES.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onPick(s.key)}
                aria-pressed={s.key === effective.key}
                className={cn(
                  "focus-ring w-full overflow-hidden rounded-lg border p-xs text-left transition-all",
                  s.key === effective.key
                    ? "border-2 border-brass-600"
                    : "border-ink-100 hover:-translate-y-0.5 hover:shadow-level-1",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.reference_images[0]}
                  alt=""
                  className="mb-xs aspect-[4/3] w-full rounded object-cover"
                  loading="lazy"
                />
                <span className="block px-xs pb-xs font-body-sm text-body-sm text-ink-900">
                  {s.name_en}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex justify-end">
        <Link
          href={nextHref}
          onClick={onConfirm}
          className="focus-ring flex h-12 items-center gap-sm rounded-lg bg-brass-600 px-xl font-body-sm text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary"
        >
          {nextLabel}
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            arrow_forward
          </span>
        </Link>
      </div>
    </div>
  );
}
