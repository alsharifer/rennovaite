import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Figure } from "@/components/blueprint/Figure";
import { Icon } from "@/components/blueprint/Icon";
import { ProvenanceMark } from "@/components/blueprint/ProvenanceMark";
import { TierLabel } from "@/components/blueprint/TierLabel";
import { PROV_TIERS } from "@/lib/provenance/tier-vocab";

// =============================================================================
// K1 — the Blueprint primitives: Figure's accessible description (spec §4.2
// #1), the decorative mark, and the house rules every new component keeps
// (no hex literals, zero radius, no SVG icon library, client-safe imports).
// =============================================================================

const ROOT = process.cwd();
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const srText = (markup: string) => /<span class="sr-only">([^<]*)<\/span>/.exec(markup)?.[1];

describe("Figure — a number with its tier, spoken as one description", () => {
  it("speaks the spec's example exactly", () => {
    const m = html(createElement(Figure, { value: 7329.7, tier: "derived", inputs: { qty: "derived", rate: "market" } }));
    expect(srText(m)).toBe("7,329.70, derived — quantity derived, rate market reference");
  });

  it("the visible number is ink, mono tabular, hidden from screen readers (no double reading)", () => {
    const m = html(createElement(Figure, { value: 4400, tier: "market" }));
    expect(m).toMatch(/<span aria-hidden="true" class="t-num-md text-bp-ink-primary">4,400.00<\/span>/);
    expect(m).toContain('data-tier="market"');
    expect(srText(m)).toBe("4,400.00, market reference");
  });

  it("a firm's own rate reads 'own basis'; an owner hears 'estimated' for derived", () => {
    expect(srText(html(createElement(Figure, { value: 96, tier: "measured", role: "rate" })))).toBe("96.00, own basis");
    expect(srText(html(createElement(Figure, { value: 69.41, tier: "derived", format: "qty", role: "qty", persona: "owner", unit: "m²" })))).toBe("69.41 m², estimated");
  });

  it("unpriced: the amount says 'to be priced', the rate '—', never a number", () => {
    const amount = html(createElement(Figure, { value: 0, tier: "unpriced" }));
    expect(amount).toContain(">to be priced<");
    expect(amount).toContain("text-bp-ink-tertiary");
    expect(amount).not.toContain("0.00");
    expect(srText(amount)).toBe("to be priced, to be priced");
    expect(html(createElement(Figure, { value: 0, tier: "unpriced", role: "rate" }))).toContain(">—<");
  });

  it("a caller's description replaces the generated one", () => {
    expect(srText(html(createElement(Figure, { value: 1, tier: "market", description: "approximately AED 1.00" })))).toBe("approximately AED 1.00");
  });
});

describe("ProvenanceMark — the 12 px glyph", () => {
  it("is decorative and 12 × 12 for every tier", () => {
    for (const t of PROV_TIERS) {
      const m = html(createElement(ProvenanceMark, { tier: t }));
      expect(m, t).toContain('aria-hidden="true"');
      expect(m, t).toContain('viewBox="0 0 12 12"');
      expect(m, t).toContain(`text-bp-prov-${t}-mark`);
    }
  });

  it("fill level changes with the hue (R2): solid / ¾ / ½ / ring / dashed", () => {
    const m = (t: (typeof PROV_TIERS)[number]) => html(createElement(ProvenanceMark, { tier: t }));
    expect(m("measured")).toMatch(/<circle[^>]*r="5"[^>]*fill="currentColor"/);
    expect(m("validated")).toContain("A5 5 0 1 1 1 6"); // 270° sweep
    expect(m("market")).toContain("A5 5 0 0 1 6 11"); // right half
    expect(m("derived")).not.toContain("<path");
    expect(m("unpriced")).toContain("stroke-dasharray");
  });

  it("TierLabel colours only the tier words, from the tier's text token", () => {
    expect(html(createElement(TierLabel, { tier: "derived", why: "site assessment" }))).toContain('class="t-label-caps text-bp-prov-derived-text">Derived — site assessment<');
    expect(html(createElement(TierLabel, { tier: "unpriced" }))).toContain("text-bp-ink-tertiary");
  });
});

describe("Icon — Material Symbols Sharp by ligature", () => {
  it("decorative by default, labelled when standalone", () => {
    expect(html(createElement(Icon, { name: "lock" }))).toBe('<span class="bp-icon" aria-hidden="true" translate="no">lock</span>');
    expect(html(createElement(Icon, { name: "lock", label: "Locked" }))).toContain('role="img" aria-label="Locked"');
  });

  it(".bp-icon is Sharp at weight 300, grade 0, optical size 20 — the one icon font", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const block = /\.bp-icon \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain('font-family: "Material Symbols Sharp"');
    expect(block).toMatch(/"wght" 300,\s*"GRAD" 0,\s*"opsz" 20/);
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain("family=Material+Symbols+Sharp");
    expect(layout).not.toContain("Material+Symbols+Outlined");
  });
});

// --- house rules for every new Blueprint file --------------------------------------

const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const BLUEPRINT_FILES = [
  ...walk("components/blueprint"),
  "lib/journey-state.ts",
  "app/project/[id]/proposal/page.tsx",
  "app/settings/page.tsx",
  "lib/provenance/tier-vocab.ts",
  "lib/provenance/tier.ts",
  "lib/theme.ts",
  "app/dev/blueprint/page.tsx",
];
const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("Blueprint house rules", () => {
  it("no hex colour literals — colours come from tokens", () => {
    for (const f of BLUEPRINT_FILES) expect(src(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("zero radius: no rounded-* other than rounded-none", () => {
    for (const f of BLUEPRINT_FILES) expect(src(f), f).not.toMatch(/\brounded-(?!none\b)[a-z0-9[]/);
  });

  it("no SVG icon libraries", () => {
    for (const f of BLUEPRINT_FILES) expect(src(f), f).not.toMatch(/lucide|@phosphor|react-icons|heroicons/);
  });

  it("components reach the tier VOCABULARY only — tierOf (and identity curation) stays on the server", () => {
    for (const f of BLUEPRINT_FILES.filter((x) => x.startsWith("components/"))) {
      expect(src(f), f).not.toMatch(/@\/lib\/provenance\/(tier|boq)"/);
      expect(src(f), f).not.toMatch(/identity\/curation/);
    }
    expect(src("lib/provenance/tier-vocab.ts")).not.toMatch(/^import /m);
  });

  it("lucide-react is gone from the app and the dependency list", () => {
    expect(src("package.json")).not.toContain("lucide-react");
    expect(JSON.parse(src("components.json")).iconLibrary).toBe("none");
  });
});
