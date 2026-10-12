import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Figure } from "@/components/blueprint/Figure";
import { Icon } from "@/components/blueprint/Icon";
import { ProvenanceMark } from "@/components/blueprint/ProvenanceMark";
import { ThemeSwitch } from "@/components/blueprint/ThemeSwitch";
import { TierLabel } from "@/components/blueprint/TierLabel";
import { formatAED, formatDelta, formatQty, formatRatio } from "@/lib/format/aed";
import { PROV_TIERS, type ProvTier } from "@/lib/provenance/tier-vocab";

// =============================================================================
// /dev/blueprint — the K1 primitives sandbox (not a product page).
//
// Every provenance tier as a mark and as a Figure, in the three token modes
// side by side — compare with Figma 3:29 (Provenance mark). Signed-in only (the
// proxy gates every page) and absent in production.
// =============================================================================

export const metadata: Metadata = { title: "Blueprint primitives · RenovAIte", robots: { index: false, follow: false } };

const MODES = [
  { key: "light", label: "Light", attrs: { "data-theme": "light" } },
  { key: "dark", label: "Dark", attrs: { "data-theme": "dark" } },
  { key: "warm", label: "Warm (owner)", attrs: { "data-theme": "light", "data-skin": "warm" } },
] as const;

// One sample line per tier; amounts multiply out (rate × qty = amount, to the fils).
const SAMPLE: Record<ProvTier, { qty: number; rate: number; amount: number; inputs: { qty: ProvTier; rate: ProvTier } }> = {
  measured: { qty: 12, rate: 264, amount: 3168, inputs: { qty: "measured", rate: "measured" } },
  validated: { qty: 54.22, rate: 26.4, amount: 1431.41, inputs: { qty: "measured", rate: "validated" } },
  market: { qty: 1, rate: 4400, amount: 4400, inputs: { qty: "measured", rate: "market" } },
  derived: { qty: 69.41, rate: 105.6, amount: 7329.7, inputs: { qty: "derived", rate: "market" } },
  unpriced: { qty: 23.74, rate: 0, amount: 0, inputs: { qty: "unpriced", rate: "unpriced" } },
};

export default function BlueprintSandboxPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <main className="min-h-screen p-6" data-system="blueprint">
      <div className="bg-bp-surface-base p-6 font-bp-sans text-bp-ink-primary">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-bp-line-hairline pb-4">
          <div>
            <p className="t-label-caps text-bp-brass-text">K1 · primitives</p>
            <h1 className="t-heading-lg">Provenance marks and figures</h1>
            <p className="t-body-sm text-bp-ink-secondary">
              Figma 3:29. Each panel sets its own mode; with the page theme on Dark, every panel follows it (tokens cascade from &lt;html&gt;).
            </p>
          </div>
          <ThemeSwitch />
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          {MODES.map((m) => (
            <section key={m.key} data-system="blueprint" {...m.attrs} data-mode={m.key} className="border border-bp-line-hairline bg-bp-surface-base p-6 text-bp-ink-primary">
              <h2 className="t-label-caps mb-4 text-bp-ink-tertiary">{m.label}</h2>

              {/* The glyphs at 1× and 4×, in Figma's order. */}
              <div className="mb-6 flex items-center gap-8 bg-bp-surface-sunken px-4 py-3" data-glyph-row="">
                {PROV_TIERS.map((t) => (
                  <ProvenanceMark key={t} tier={t} />
                ))}
              </div>
              <div className="mb-6 flex items-center gap-8 px-4">
                {PROV_TIERS.map((t) => (
                  <ProvenanceMark key={t} tier={t} className="h-12 w-12" />
                ))}
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-bp-surface-sunken">
                    {["Tier", "Qty", "Rate", "Amount"].map((h) => (
                      <th key={h} className="t-label-caps px-2 py-1 text-left text-bp-ink-tertiary">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PROV_TIERS.map((t) => {
                    const s = SAMPLE[t];
                    return (
                      <tr key={t} className="border-b border-bp-line-hairline">
                        <td className="t-body-sm px-2 py-2">
                          <TierLabel tier={t} />
                        </td>
                        <td className="px-2 py-2">
                          <Figure value={s.qty} tier={s.inputs.qty === "unpriced" ? "derived" : s.inputs.qty} format="qty" role="qty" />
                        </td>
                        <td className="px-2 py-2">
                          <Figure value={s.rate} tier={s.inputs.rate} role="rate" />
                        </td>
                        <td className="px-2 py-2">
                          <Figure value={s.amount} tier={t} inputs={s.inputs} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-6 flex items-center gap-4 text-bp-ink-secondary">
                <Icon name="lock" />
                <Icon name="flag" />
                <Icon name="history" />
                <Icon name="description" />
                <span className="t-label-md">Icon · Sharp 300 / opsz 20</span>
              </div>
              <p className="t-num-xl mt-6">≈ AED {formatAED(116679.56)}*</p>
              <p className="t-label-md text-bp-ink-tertiary">
                {formatQty(1)} · {formatQty(69.41)} · {formatDelta(-0.04)} · {formatDelta(1234.5)} · {formatDelta(4.2, "pct")} · {formatRatio(17.86)}
              </p>
              <div className="surface-inverse mt-6 bg-bp-alert-surface p-4 text-bp-alert-ink">
                <p className="t-heading-sm">Inverse block</p>
                <p className="t-body-sm">The only error / refusal treatment.</p>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
