"use client";

// =============================================================================
// components/blueprint/design/DirectionView.tsx — 02 Design · Direction (K8
// #3, spec §6.3, Figma 55:296). Replaces /ideation + /style.
//
// Left 320 — "Your answers": the B1 questionnaire (six weighted questions, no
// LLM — the same answers always give the same suggestion). Unanswered → one
// question at a time in this column; answered → the list, each with "Change".
// Right — the selected direction (raised, brass 2 px left rule, check + name,
// 2×2 images, the match sentence, the cost delta WITH the derived mark — it is
// an indicative estimate), then the other directions 3-up with "Choose".
//
// The rule from B1 holds: the RECOMMENDATION and the owner's OWN PICK are
// separate values (project_briefs.recommended_style_key / override_style_key);
// a changed answer recomputes the first and never touches the second. The
// direction the rest of the app uses is written to style_choices whenever it
// changes (a pick, or a completed brief with no pick of its own).
// =============================================================================

import { useCallback, useMemo, useState } from "react";

import { AnalyticsEvent, track } from "@/lib/analytics";
import { formatAED } from "@/lib/format/aed";
import { QUESTIONS, briefProgress, type BriefAnswers, type Question, type Recommendation } from "@/lib/ideation/questionnaire";
import { tierLabel } from "@/lib/provenance/tier-vocab";
import { STYLES, type Style } from "@/lib/styles";

import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProvenanceMark } from "../ProvenanceMark";
import { StateBlock } from "../StateBlock";

export interface IdeationBrief {
  answers: BriefAnswers;
  recommended_style_key: string | null;
  override_style_key: string | null;
  recommendation: Partial<Recommendation> | null;
  completed_at: string | null;
}

/** The answers list's short names, in the questionnaire's order. */
export const ANSWER_LABEL: Record<string, string> = {
  palette: "Palette",
  materials: "Materials",
  ornament: "Detail",
  hosting: "How you live",
  light: "Light",
  spend: "Spend",
};

const styleByKey = new Map(STYLES.map((s) => [s.key, s]));

const selectedIds = (q: Question, answers: BriefAnswers): string[] => {
  const raw = answers[q.id];
  return raw == null ? [] : Array.isArray(raw) ? raw : [raw];
};

/** "Matches 5 of your 6 answers — palette, materials, …": the answers whose picks lean toward this direction. */
export function matchSentence(style: Style, answers: BriefAnswers): string | null {
  const answered = QUESTIONS.filter((q) => selectedIds(q, answers).length > 0);
  if (answered.length === 0) return null;
  const hits = answered.filter((q) => selectedIds(q, answers).some((id) => (q.options.find((o) => o.id === id)?.weights[style.key] ?? 0) > 0));
  const names = hits.map((q) => (ANSWER_LABEL[q.id] ?? q.id).toLowerCase());
  return `Matches ${hits.length} of your ${answered.length} answer${answered.length === 1 ? "" : "s"}${names.length ? ` — ${names.join(", ")}` : ""}`;
}

/** The style's indicative cost delta, signed ("+AED 60,000", "±AED 0", "−AED 25,000"). */
function delta(n: number): string {
  if (n === 0) return "±AED 0";
  return `${n > 0 ? "+" : "−"}AED ${Math.abs(n).toLocaleString("en-US")}`;
}

function Delta({ value, size = "md" }: { value: number; size?: "md" | "sm" }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={size === "md" ? "t-num-md text-bp-ink-primary" : "t-num-sm text-bp-ink-primary"}>
        {delta(value)}
      </span>
      <ProvenanceMark tier="derived" />
      <span className="sr-only">
        {value === 0 ? "no change" : `${value > 0 ? "plus" : "minus"} AED ${formatAED(Math.abs(value))}`} against a baseline finish, {tierLabel("derived", "owner").toLowerCase()}
      </span>
    </span>
  );
}

export function DirectionView({ projectId, initialBrief, referencesHref }: { projectId: string; initialBrief: IdeationBrief | null; referencesHref: string }) {
  const [answers, setAnswers] = useState<BriefAnswers>(initialBrief?.answers ?? {});
  const [recommended, setRecommended] = useState<string | null>(initialBrief?.recommended_style_key ?? null);
  const [override, setOverride] = useState<string | null>(initialBrief?.override_style_key ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useMemo(() => briefProgress(answers), [answers]);
  // walk = first pass, one question after another; edit = "Change" on one answer.
  const [cursor, setCursor] = useState<{ i: number; mode: "walk" | "edit" } | null>(() => {
    const i = QUESTIONS.findIndex((q) => (initialBrief?.answers ?? {})[q.id] == null);
    return i === -1 ? null : { i, mode: "walk" };
  });

  const effectiveKey = override ?? recommended;
  const effective = effectiveKey ? (styleByKey.get(effectiveKey) ?? null) : null;
  const recommendedStyle = recommended ? (styleByKey.get(recommended) ?? null) : null;

  const lockStyle = useCallback(
    async (key: string | null) => {
      if (!key) return;
      // The direction the render, BoQ and drawings read.
      await fetch("/api/style-choice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, style_key: key }) }).catch(() => {});
    },
    [projectId],
  );

  const save = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/project-brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, ...payload }) });
        const body = await res.json();
        if (!res.ok || body.error) throw new Error(body.error ?? "Your answer wasn't saved.");
        // The server owns the recommendation — mirror what it decided.
        setRecommended(body.brief?.recommended_style_key ?? null);
        setOverride(body.brief?.override_style_key ?? null);
        return body as { brief?: { recommended_style_key: string | null; override_style_key: string | null } };
      } catch (e) {
        setError(e instanceof Error ? e.message : "Your answer wasn't saved.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [projectId],
  );

  const answer = async (q: Question, optionId: string) => {
    const current = selectedIds(q, answers);
    const next: string | string[] = q.multi ? (current.includes(optionId) ? current.filter((x) => x !== optionId) : [...current, optionId]) : optionId;
    const merged = { ...answers, [q.id]: next };
    setAnswers(merged);
    const complete = briefProgress(merged).complete;
    const body = await save({ answers: { [q.id]: next }, ...(complete ? { complete: true } : {}) });
    if (body && complete && !body.brief?.override_style_key) await lockStyle(body.brief?.recommended_style_key ?? null);
    if (!q.multi) advance();
  };

  const advance = () => {
    setCursor((c) => {
      if (!c || c.mode === "edit") return null;
      const i = QUESTIONS.findIndex((q, idx) => idx > c.i && answers[q.id] == null);
      return i === -1 ? null : { i, mode: "walk" };
    });
  };

  const choose = async (key: string | null) => {
    if (saving) return;
    setOverride(key);
    await save({ override_style_key: key });
    await lockStyle(key ?? recommended);
    if (key) track(AnalyticsEvent.StyleSelected, { project_id: projectId, style_key: key });
  };

  const q = cursor ? QUESTIONS[cursor.i]! : null;
  const others = STYLES.filter((s) => s.key !== effective?.key);

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* Your answers */}
      <section aria-labelledby="answers-h">
        <div className="flex items-baseline border-b-2 border-bp-line-strong pb-2.5">
          <h2 id="answers-h" className="t-heading-md flex-1 text-bp-ink-primary">
            Your answers
          </h2>
          <span className="t-label-md font-bp-mono text-bp-ink-tertiary" aria-label={`${progress.answered} of ${progress.total} answered`}>
            {progress.answered} / {progress.total}
          </span>
        </div>

        {q ? (
          <fieldset className="pt-4" data-question={q.id}>
            <legend className="t-label-caps text-bp-ink-tertiary">{(ANSWER_LABEL[q.id] ?? q.id).toUpperCase()}</legend>
            <p className="t-heading-sm mt-1.5 text-bp-ink-primary">{q.prompt}</p>
            {q.hint ? <p className="t-body-sm mt-1 text-bp-ink-secondary">{q.hint}</p> : null}
            <ul className="mt-3 flex flex-col gap-2">
              {q.options.map((o) => {
                const on = selectedIds(q, answers).includes(o.id);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={saving}
                      onClick={() => void answer(q, o.id)}
                      className={`relative flex w-full items-start gap-2 border px-3 py-2.5 text-left outline-offset-2 ${on ? "border-bp-line-strong bg-bp-surface-raised before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass" : "border-bp-line-control hover:bg-bp-surface-raised"}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="t-heading-sm block text-bp-ink-primary">{o.label}</span>
                        {o.hint ? <span className="t-body-sm block text-bp-ink-secondary">{o.hint}</span> : null}
                      </span>
                      {on ? <Icon name="check" className="text-[20px] text-bp-ink-primary" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex items-center gap-4">
              {q.multi ? (
                <Button kind="secondary" onClick={advance} disabled={selectedIds(q, answers).length === 0 ? { reason: "Pick at least one", reasonId: "q-multi-reason", showReason: true } : false}>
                  {cursor?.mode === "edit" ? "Done" : "Continue"}
                </Button>
              ) : null}
              {cursor?.mode === "edit" ? (
                <Button kind="quiet" onClick={() => setCursor(null)}>
                  Cancel
                </Button>
              ) : cursor && cursor.i > 0 ? (
                <Button kind="quiet" onClick={() => setCursor({ i: cursor.i - 1, mode: "walk" })}>
                  Back
                </Button>
              ) : null}
            </div>
          </fieldset>
        ) : (
          <ul>
            {QUESTIONS.map((question, i) => {
              const picked = selectedIds(question, answers).map((id) => question.options.find((o) => o.id === id)?.label).filter(Boolean);
              return (
                <li key={question.id} className="flex items-center gap-3 border-b border-bp-line-hairline py-3">
                  <span className="min-w-0 flex-1">
                    <span className="t-label-caps block text-bp-ink-tertiary">{(ANSWER_LABEL[question.id] ?? question.id).toUpperCase()}</span>
                    <span className={`t-body-sm block ${picked.length ? "text-bp-ink-primary" : "text-bp-ink-tertiary"}`}>{picked.length ? picked.join(" + ") : "Not answered"}</span>
                  </span>
                  <Button kind="quiet" onClick={() => setCursor({ i, mode: picked.length ? "edit" : "walk" })} aria-label={`Change ${(ANSWER_LABEL[question.id] ?? question.id).toLowerCase()}`}>
                    {picked.length ? "Change" : "Answer"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="t-body-sm mt-3 text-bp-ink-secondary">Deterministic: the same answers always give the same suggestion. Changing an answer never changes a direction you picked yourself.</p>
        {error ? (
          <div className="mt-3">
            <StateBlock kind="error" title="That wasn't saved" afterUserAction>
              {error}
            </StateBlock>
          </div>
        ) : null}
      </section>

      {/* The direction */}
      <section aria-labelledby="direction-h" className="min-w-0">
        <h2 id="direction-h" className="t-label-caps text-bp-ink-tertiary">
          {effective ? (override && override !== recommended ? "YOUR PICK · SELECTED" : "SUGGESTED FOR YOU · SELECTED") : "DIRECTIONS"}
        </h2>
        {effective ? (
          <div className="relative mt-3 grid grid-cols-1 gap-6 border border-bp-line-hairline bg-bp-surface-raised p-5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-bp-brass md:grid-cols-[minmax(0,310px)_minmax(0,1fr)]" data-selected-direction={effective.key}>
            <ul className="grid grid-cols-2 gap-1.5" aria-label={`${effective.name_en} — sample images`}>
              {effective.reference_images.slice(0, 4).map((src, i) => (
                <li key={src}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static style art */}
                  <img src={src} alt={`${effective.name_en} sample ${i + 1}`} className="aspect-[3/2] w-full border border-bp-line-hairline object-cover" loading="lazy" />
                </li>
              ))}
            </ul>
            <div className="min-w-0">
              <p className="t-label-caps flex items-center gap-2 text-bp-ink-primary">
                <Icon name="check" className="text-[20px]" />
                {effective.name_en.toUpperCase()}
              </p>
              <p className="t-heading-md mt-2 text-bp-ink-primary">{effective.one_line}</p>
              {matchSentence(effective, answers) ? <p className="t-body-sm mt-2 text-bp-ink-secondary">{matchSentence(effective, answers)}.</p> : null}
              <p className="mt-3 flex flex-wrap items-center gap-x-3">
                <span className="t-label-caps text-bp-ink-tertiary">COST VS BASELINE FINISH</span>
                <Delta value={effective.cost_delta_aed} />
              </p>
              <p className="t-body-sm mt-2 text-bp-ink-secondary">Indicative — the BoQ prices your actual choices in 04 Cost.</p>
              {override && override !== recommended && recommendedStyle ? (
                <p className="t-body-sm mt-2 text-bp-ink-secondary">
                  We suggested {recommendedStyle.name_en}.{" "}
                  <Button kind="quiet" onClick={() => void choose(null)}>
                    Use it instead
                  </Button>
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-5">
                <Button kind="secondary" href={referencesHref}>
                  Pin references
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <StateBlock kind="empty" icon="palette" title="No direction yet">
              Answer the questions and we suggest one — or choose any of the six below yourself.
            </StateBlock>
          </div>
        )}

        <h2 className="t-label-caps mt-6 text-bp-ink-tertiary">{effective ? "OTHER DIRECTIONS" : "ALL DIRECTIONS"}</h2>
        <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {others.map((s) => (
            <li key={s.key} className="border border-bp-line-hairline" data-direction={s.key}>
              {/* eslint-disable-next-line @next/next/no-img-element -- static style art */}
              <img src={s.reference_images[0]} alt="" className="aspect-[2/1] w-full border-b border-bp-line-hairline object-cover" loading="lazy" />
              <div className="p-3">
                <p className="t-label-caps text-bp-ink-primary">{s.name_en.toUpperCase()}</p>
                <p className="t-body-sm mt-1 text-bp-ink-secondary">{s.one_line}</p>
                <p className="mt-2">
                  <Delta value={s.cost_delta_aed} size="sm" />
                </p>
                <div className="mt-3">
                  <Button kind="quiet" onClick={() => void choose(s.key)} aria-label={`Choose ${s.name_en}`}>
                    Choose
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
