import { describe, expect, it } from "vitest";

import {
  QUESTIONS,
  STYLE_KEYS,
  briefProgress,
  effectiveStyleKey,
  recommendStyle,
  sanitiseAnswers,
  type BriefAnswers,
} from "@/lib/ideation/questionnaire";
import { STYLES } from "@/lib/styles";

describe("questionnaire data integrity", () => {
  it("weights only reference real style keys", () => {
    const known = new Set(STYLE_KEYS as readonly string[]);
    for (const q of QUESTIONS) {
      for (const o of q.options) {
        for (const key of Object.keys(o.weights)) {
          expect(known.has(key), `${q.id}/${o.id} → ${key}`).toBe(true);
        }
      }
    }
  });

  it("STYLE_KEYS matches the style library exactly", () => {
    expect([...STYLE_KEYS].sort()).toEqual(STYLES.map((s) => s.key).sort());
  });

  it("has unique question and option ids", () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    for (const q of QUESTIONS) {
      expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length);
    }
  });

  it("gives every style a route to winning", () => {
    // A style nothing can recommend is dead weight in the picker.
    const reachable = new Set<string>();
    for (const q of QUESTIONS) {
      for (const o of q.options) {
        for (const [k, w] of Object.entries(o.weights)) {
          if ((w ?? 0) > 0) reachable.add(k);
        }
      }
    }
    expect([...reachable].sort()).toEqual([...STYLE_KEYS].sort());
  });
});

describe("recommendStyle", () => {
  it("returns no recommendation for an empty brief", () => {
    const rec = recommendStyle({});
    expect(rec.recommended_style_key).toBeNull();
    expect(rec.answered).toEqual([]);
    expect(rec.why).toEqual([]);
    // Every style still ranks, so the UI can show the full list.
    expect(rec.ranked).toHaveLength(STYLE_KEYS.length);
  });

  it("is deterministic — the same answers always give the same ranking", () => {
    const answers: BriefAnswers = {
      palette: "warm-earth",
      materials: ["wood", "metal"],
      ornament: "some",
      hosting: "formal",
      light: "soft",
      spend: "balanced",
    };
    const a = recommendStyle(answers);
    const b = recommendStyle({ ...answers });
    expect(a.recommended_style_key).toBe(b.recommended_style_key);
    expect(a.ranked).toEqual(b.ranked);
  });

  it("recommends the direction the answers actually point at", () => {
    // Warm earth + brass + formal hosting is the Contemporary Majlis profile.
    const majlis = recommendStyle({
      palette: "warm-earth",
      materials: ["wood", "metal"],
      hosting: "formal",
      light: "soft",
    });
    expect(majlis.recommended_style_key).toBe("contemporary-majlis");

    // Bright, casual, below-baseline is the Scandi-Arabic profile.
    const scandi = recommendStyle({
      palette: "cool-calm",
      hosting: "casual",
      light: "bright",
      spend: "value",
    });
    expect(scandi.recommended_style_key).toBe("scandi-arabic");

    // Rich ornament + dramatic light + premium spend is Andalusian/Hijazi.
    const rich = recommendStyle({
      palette: "deep-rich",
      ornament: "lots",
      light: "dramatic",
      spend: "premium",
    });
    expect(["andalusian-heritage", "modern-hijazi"]).toContain(
      rich.recommended_style_key,
    );
  });

  it("ranks in descending score with a stable tiebreak", () => {
    const rec = recommendStyle({ palette: "warm-earth" });
    for (let i = 1; i < rec.ranked.length; i++) {
      expect(rec.ranked[i - 1]!.score).toBeGreaterThanOrEqual(rec.ranked[i]!.score);
    }
    // Ties resolve by STYLE_KEYS order, so repeated calls cannot flip.
    expect(recommendStyle({ palette: "warm-earth" }).ranked).toEqual(rec.ranked);
  });

  it("works on a partial brief and reports which questions counted", () => {
    const rec = recommendStyle({ palette: "mono", spend: "premium" });
    expect(rec.answered).toEqual(["palette", "spend"]);
    expect(rec.recommended_style_key).toBe("luxe-minimal");
    expect(rec.ranked[0]!.confidence).toBeGreaterThan(0);
    expect(rec.ranked[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it("explains the winner with the options that lifted it", () => {
    const rec = recommendStyle({ palette: "mono", ornament: "none" });
    expect(rec.why.length).toBeGreaterThan(0);
    for (const w of rec.why) expect(w).toContain("—");
  });

  it("ignores answers that are not real options", () => {
    const bogus = recommendStyle({ palette: "chartreuse", nonsense: "x" });
    expect(bogus.recommended_style_key).toBeNull();
    expect(bogus.answered).toEqual([]);
  });

  it("confidence stays within 0..1 for every combination of one answer", () => {
    for (const q of QUESTIONS) {
      for (const o of q.options) {
        const rec = recommendStyle({ [q.id]: q.multi ? [o.id] : o.id });
        for (const r of rec.ranked) {
          expect(r.confidence).toBeGreaterThanOrEqual(0);
          expect(r.confidence).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("sanitiseAnswers", () => {
  it("strips unknown questions, unknown options and wrong shapes", () => {
    expect(
      sanitiseAnswers({
        palette: "warm-earth",
        materials: ["wood", "unobtainium"],
        ornament: ["not-an-array-question"],
        ghost: "x",
        spend: 42,
      }),
    ).toEqual({ palette: "warm-earth", materials: ["wood"] });
  });

  it("returns {} for junk input", () => {
    expect(sanitiseAnswers(null)).toEqual({});
    expect(sanitiseAnswers("nope")).toEqual({});
    expect(sanitiseAnswers([1, 2])).toEqual({});
  });
});

describe("briefProgress", () => {
  it("counts answered questions and flags completion", () => {
    expect(briefProgress({})).toEqual({
      answered: 0,
      total: QUESTIONS.length,
      complete: false,
    });
    const all: BriefAnswers = Object.fromEntries(
      QUESTIONS.map((q) => [q.id, q.multi ? [q.options[0]!.id] : q.options[0]!.id]),
    );
    expect(briefProgress(all).complete).toBe(true);
  });
});

describe("effectiveStyleKey — a manual pick always wins", () => {
  it("prefers the override over the recommendation", () => {
    expect(
      effectiveStyleKey({
        recommended_style_key: "scandi-arabic",
        override_style_key: "luxe-minimal",
      }),
    ).toBe("luxe-minimal");
  });

  it("falls back to the recommendation when there is no override", () => {
    expect(
      effectiveStyleKey({ recommended_style_key: "scandi-arabic", override_style_key: null }),
    ).toBe("scandi-arabic");
  });

  it("is null when neither exists", () => {
    expect(effectiveStyleKey({})).toBeNull();
  });

  it("re-running the recommender cannot disturb an override", () => {
    // The property the whole flow rests on: recommendation is a pure function
    // of answers, and the override is a separate field the recommender never
    // reads or writes.
    const override = "andalusian-heritage";
    const first = recommendStyle({ palette: "cool-calm", light: "bright" });
    const second = recommendStyle({ palette: "deep-rich", light: "dramatic" });
    expect(first.recommended_style_key).not.toBe(second.recommended_style_key);
    expect(effectiveStyleKey({ recommended_style_key: first.recommended_style_key, override_style_key: override })).toBe(override);
    expect(effectiveStyleKey({ recommended_style_key: second.recommended_style_key, override_style_key: override })).toBe(override);
  });
});
