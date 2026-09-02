// =============================================================================
// lib/ideation/questionnaire.ts — the B1 guided questionnaire + recommender.
//
// Pure data + pure arithmetic. NO LLM: a style recommendation has to be
// re-runnable and reproducible — the same answers must always yield the same
// ranking, or "re-run the recommendation" becomes a dice roll and a user can
// never tell whether their edit or the model moved the result.
//
// Every option carries a weight per style key from lib/styles.ts. Scoring is a
// plain weighted sum, normalised to 0..1 against the best possible score for
// the questions actually answered, so a partially-filled brief still ranks
// sensibly and the confidence figure means something.
// =============================================================================

import { STYLES, type Style } from "@/lib/styles";

export type StyleKey = string;

export interface QuestionOption {
  id: string;
  label: string;
  /** One-line elaboration shown under the option. */
  hint?: string;
  /** Per-style affinity, -2..3. Absent = 0 (neutral). */
  weights: Partial<Record<StyleKey, number>>;
}

export interface Question {
  id: string;
  /** The question as asked. */
  prompt: string;
  /** Short helper under the prompt. */
  hint?: string;
  options: QuestionOption[];
  /** true = the user may pick several options (weights sum). */
  multi?: boolean;
}

// The six style keys these weights are written against. Kept as a constant so
// a typo in a weight key fails a test rather than silently scoring nothing.
export const STYLE_KEYS = [
  "contemporary-majlis",
  "modern-hijazi",
  "coastal-emirati",
  "scandi-arabic",
  "andalusian-heritage",
  "luxe-minimal",
] as const;

export const QUESTIONS: Question[] = [
  {
    id: "palette",
    prompt: "Which palette feels like home?",
    hint: "The base tone every other choice sits on.",
    options: [
      {
        id: "warm-earth",
        label: "Warm earth",
        hint: "Sand, walnut, terracotta, brass",
        weights: {
          "contemporary-majlis": 3,
          "andalusian-heritage": 2,
          "coastal-emirati": 1,
          "modern-hijazi": 1,
        },
      },
      {
        id: "cool-calm",
        label: "Cool and calm",
        hint: "Chalk, pale oak, soft grey",
        weights: { "scandi-arabic": 3, "luxe-minimal": 2, "coastal-emirati": 2 },
      },
      {
        id: "deep-rich",
        label: "Deep and rich",
        hint: "Mahogany, teal, oxblood",
        weights: { "modern-hijazi": 3, "andalusian-heritage": 2, "contemporary-majlis": 1 },
      },
      {
        id: "mono",
        label: "Near-monochrome",
        hint: "Stone, plaster, a single metal",
        weights: { "luxe-minimal": 3, "scandi-arabic": 1, "contemporary-majlis": -1 },
      },
    ],
  },
  {
    id: "materials",
    prompt: "Which materials do you want to touch?",
    hint: "Pick as many as you like.",
    multi: true,
    options: [
      {
        id: "wood",
        label: "Warm timber",
        weights: { "contemporary-majlis": 2, "modern-hijazi": 2, "scandi-arabic": 2 },
      },
      {
        id: "stone",
        label: "Stone and marble",
        weights: { "luxe-minimal": 3, "contemporary-majlis": 1 },
      },
      {
        id: "plaster",
        label: "Hand-finished plaster",
        weights: { "modern-hijazi": 2, "andalusian-heritage": 2, "coastal-emirati": 2 },
      },
      {
        id: "tile",
        label: "Patterned tile",
        weights: { "andalusian-heritage": 3, "modern-hijazi": 1, "luxe-minimal": -1 },
      },
      {
        id: "metal",
        label: "Brass and bronze",
        weights: { "contemporary-majlis": 2, "luxe-minimal": 1 },
      },
    ],
  },
  {
    id: "ornament",
    prompt: "How much pattern and ornament?",
    options: [
      {
        id: "none",
        label: "Almost none",
        hint: "Let the materials do the talking",
        weights: { "luxe-minimal": 3, "scandi-arabic": 2, "andalusian-heritage": -2 },
      },
      {
        id: "some",
        label: "A considered amount",
        hint: "One or two feature moments per room",
        weights: { "contemporary-majlis": 2, "coastal-emirati": 2, "modern-hijazi": 1 },
      },
      {
        id: "lots",
        label: "Rich and layered",
        hint: "Carving, zellige, screens",
        weights: { "andalusian-heritage": 3, "modern-hijazi": 3, "luxe-minimal": -2 },
      },
    ],
  },
  {
    id: "hosting",
    prompt: "How do you host?",
    hint: "This shapes the majlis and living areas most.",
    options: [
      {
        id: "majlis-floor",
        label: "Traditional majlis",
        hint: "Floor seating, large gatherings",
        weights: { "andalusian-heritage": 2, "modern-hijazi": 2, "contemporary-majlis": 1 },
      },
      {
        id: "formal",
        label: "Formal sitting room",
        hint: "Raised seating, guests received properly",
        weights: { "contemporary-majlis": 3, "luxe-minimal": 2 },
      },
      {
        id: "casual",
        label: "Casual and family-first",
        hint: "Everything open, nothing precious",
        weights: { "scandi-arabic": 3, "coastal-emirati": 2 },
      },
    ],
  },
  {
    id: "light",
    prompt: "What should the light feel like?",
    options: [
      {
        id: "bright",
        label: "Bright and airy",
        weights: { "coastal-emirati": 3, "scandi-arabic": 3 },
      },
      {
        id: "soft",
        label: "Soft and diffused",
        weights: { "luxe-minimal": 2, "contemporary-majlis": 2, "scandi-arabic": 1 },
      },
      {
        id: "dramatic",
        label: "Warm and dramatic",
        hint: "Pools of light, deep shadow",
        weights: { "modern-hijazi": 3, "andalusian-heritage": 2 },
      },
    ],
  },
  {
    id: "spend",
    prompt: "Where should the budget land?",
    hint: "Against an AED 850k baseline for the first-floor refit.",
    options: [
      {
        id: "value",
        label: "Below baseline",
        hint: "Restraint, fewer bespoke pieces",
        weights: { "scandi-arabic": 3, "coastal-emirati": 2, "luxe-minimal": -2, "andalusian-heritage": -1 },
      },
      {
        id: "balanced",
        label: "Around baseline",
        weights: { "coastal-emirati": 2, "contemporary-majlis": 1, "scandi-arabic": 1 },
      },
      {
        id: "premium",
        label: "Above baseline",
        hint: "Specialist joinery, natural stone",
        weights: { "luxe-minimal": 3, "andalusian-heritage": 2, "modern-hijazi": 2 },
      },
    ],
  },
];

/** Answers as persisted: question id → chosen option id(s). */
export type BriefAnswers = Record<string, string | string[]>;

export interface StyleScore {
  style_key: StyleKey;
  /** Raw weighted sum. */
  score: number;
  /** 0..1 against the best achievable score for the answered questions. */
  confidence: number;
}

export interface Recommendation {
  /** Highest-scoring style, or null when nothing has been answered. */
  recommended_style_key: StyleKey | null;
  /** Every style, best first. Ties broken by STYLE_KEYS order for stability. */
  ranked: StyleScore[];
  /** Question ids that contributed. */
  answered: string[];
  /** Human-readable reasons, drawn from the options that moved the winner. */
  why: string[];
}

const QUESTION_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

/** Selected option ids for a question, normalised to an array. */
function selectedIds(q: Question, answers: BriefAnswers): string[] {
  const raw = answers[q.id];
  if (raw == null) return [];
  const ids = Array.isArray(raw) ? raw : [raw];
  // Drop anything that is not a real option for this question — a stale answer
  // from an edited questionnaire must not silently score.
  const valid = new Set(q.options.map((o) => o.id));
  return ids.filter((id) => valid.has(id));
}

/**
 * Score every style against the answers. Deterministic and total: unanswered
 * questions simply do not contribute, and an empty brief returns a null
 * recommendation rather than an arbitrary first style.
 */
export function recommendStyle(answers: BriefAnswers): Recommendation {
  const totals = new Map<StyleKey, number>();
  for (const k of STYLE_KEYS) totals.set(k, 0);

  const answered: string[] = [];
  // Best achievable score per question, for normalisation.
  let bestPossible = 0;
  const contributions: { question: Question; option: QuestionOption }[] = [];

  for (const q of QUESTIONS) {
    const ids = selectedIds(q, answers);
    if (ids.length === 0) continue;
    answered.push(q.id);

    for (const id of ids) {
      const opt = q.options.find((o) => o.id === id);
      if (!opt) continue;
      contributions.push({ question: q, option: opt });
      for (const [key, w] of Object.entries(opt.weights)) {
        totals.set(key, (totals.get(key) ?? 0) + (w ?? 0));
      }
    }
    // A question's ceiling is its best single option (or, for multi, the sum of
    // the picks' best-case weights) — so confidence reflects what was asked.
    const perOptionMax = q.options.map((o) =>
      Math.max(0, ...Object.values(o.weights).map((w) => w ?? 0)),
    );
    bestPossible += q.multi
      ? ids.reduce((s, id) => {
          const i = q.options.findIndex((o) => o.id === id);
          return s + (i >= 0 ? perOptionMax[i]! : 0);
        }, 0)
      : Math.max(0, ...perOptionMax);
  }

  const ranked: StyleScore[] = STYLE_KEYS.map((key) => {
    const score = totals.get(key) ?? 0;
    return {
      style_key: key,
      score,
      confidence:
        bestPossible > 0
          ? Math.round(Math.max(0, Math.min(1, score / bestPossible)) * 100) / 100
          : 0,
    };
  }).sort(
    (a, b) =>
      b.score - a.score ||
      STYLE_KEYS.indexOf(a.style_key as (typeof STYLE_KEYS)[number]) -
        STYLE_KEYS.indexOf(b.style_key as (typeof STYLE_KEYS)[number]),
  );

  const winner = answered.length > 0 && ranked[0] && ranked[0].score > 0 ? ranked[0] : null;

  // Explain the result with the options that actually pushed the winner up.
  const why = winner
    ? contributions
        .filter(({ option }) => (option.weights[winner.style_key] ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.option.weights[winner.style_key] ?? 0) -
            (a.option.weights[winner.style_key] ?? 0),
        )
        .slice(0, 3)
        .map(({ question, option }) => `${question.prompt} — ${option.label}`)
    : [];

  return {
    recommended_style_key: winner?.style_key ?? null,
    ranked,
    answered,
    why,
  };
}

/** Progress through the questionnaire, for the step chrome. */
export function briefProgress(answers: BriefAnswers): {
  answered: number;
  total: number;
  complete: boolean;
} {
  const answered = QUESTIONS.filter(
    (q) => selectedIds(q, answers).length > 0,
  ).length;
  return { answered, total: QUESTIONS.length, complete: answered === QUESTIONS.length };
}

/** Resolve the style a project should use: a manual override always wins. */
export function effectiveStyleKey(brief: {
  recommended_style_key?: string | null;
  override_style_key?: string | null;
}): string | null {
  return brief.override_style_key ?? brief.recommended_style_key ?? null;
}

/** Style objects for the recommendation, best first — for sample imagery. */
export function rankedStyles(rec: Recommendation): Style[] {
  return rec.ranked
    .map((r) => STYLES.find((s) => s.key === r.style_key))
    .filter((s): s is Style => s !== undefined);
}

/** Validate + strip an answers payload down to known questions and options. */
export function sanitiseAnswers(raw: unknown): BriefAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: BriefAnswers = {};
  for (const [qid, value] of Object.entries(raw as Record<string, unknown>)) {
    const q = QUESTION_BY_ID.get(qid);
    if (!q) continue;
    const valid = new Set(q.options.map((o) => o.id));
    if (q.multi) {
      const ids = (Array.isArray(value) ? value : [value])
        .filter((v): v is string => typeof v === "string" && valid.has(v));
      if (ids.length > 0) out[qid] = ids;
    } else if (typeof value === "string" && valid.has(value)) {
      out[qid] = value;
    }
  }
  return out;
}
