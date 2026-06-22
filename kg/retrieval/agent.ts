/* eslint-disable @typescript-eslint/no-explicit-any -- vendored module; the
   neo4j record accessors are intentionally untyped. Keep verbatim with the KG
   module so the two stay in sync. */
/**
 * RennovAIte KG retrieval agent.
 *
 * Given a brief (community / style / propertyType / budget) it traverses
 * the KG and returns a ContextBundle that the render / BoQ prompt can
 * splice in directly.
 *
 * Usage from a Next.js route handler:
 *
 *   import { retrieveContextBundle, formatBundleForPrompt } from "@/kg/retrieval/agent";
 *   const bundle = await retrieveContextBundle({
 *     community: "community:arabian-ranches",
 *     style: "style:minimalist",
 *     propertyType: "property:villa-type-3-saheel",
 *     budgetTiers: ["premium", "luxury"],
 *   });
 *   const promptContext = formatBundleForPrompt(bundle);
 *   // ...append promptContext to your existing render prompt
 *
 * VENDORED from the standalone KG module (../RennovAIte/kg/retrieval/agent.ts).
 * This app only *consumes* a running Neo4j — the loader, seed, and
 * docker-compose stay in the KG module. Keep this file in sync if the KG
 * retrieval contract changes.
 */
import neo4j, { Driver } from "neo4j-driver";

// ---------- types ----------
export interface Brief {
  community: string;            // e.g. "community:arabian-ranches"
  style: string;                // e.g. "style:minimalist"
  propertyType: string;         // e.g. "property:villa-type-3-saheel"
  budgetTiers?: string[];       // default ["mid","premium","luxury"]
  perSpaceFixtureLimit?: number; // default 6
  materialLimit?: number;        // default 15
}

export interface MaterialOut {
  id: string;
  label: string;
  category: string;
  surface?: string;
  color_hex?: string;
  score: number;
}

export interface FixtureOut {
  id: string;
  label: string;
  sub_category: string;
  vendor: string;
  vendor_id: string;
  price_aed?: number;
  lead_time_days?: number;
  score: number;
}

export interface SpaceOut {
  id: string;
  label: string;
  category: string;
  typical_area_sqm_range?: number[];
  fixtures: FixtureOut[];
}

export interface RegulationOut {
  id: string;
  label: string;
  scope: string;
  rule_text: string;
  approval_required: boolean;
}

export interface ContextBundle {
  bundleId: string;             // unique id for this retrieval — used by the feedback loop
  brief: Brief;
  community: { id: string; label: string; sub_communities?: string[] };
  style: { id: string; label: string; key_traits?: string[] };
  propertyType: { id: string; label: string; bedrooms?: number; gfa_sqm?: number };
  palettes: { id: string; label: string; hex_values: string[] }[];
  climate?: { id: string; label: string; constraints: string[] };
  culturalRequirements: { space_ids: string[]; rules: string[] };
  regulations: RegulationOut[];
  materials: MaterialOut[];
  spaces: SpaceOut[];
  warnings: string[];
}

// ---------- driver singleton ----------
let _driver: Driver | null = null;
function getDriver(): Driver {
  if (_driver) return _driver;
  const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
  const user = process.env.NEO4J_USER ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD ?? "rennovaite_dev";
  _driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return _driver;
}

export async function closeDriver() {
  if (_driver) {
    await _driver.close();
    _driver = null;
  }
}

// ---------- main retrieval ----------
export async function retrieveContextBundle(brief: Brief): Promise<ContextBundle> {
  const budgetTiers = brief.budgetTiers ?? ["mid", "premium", "luxury"];
  const perSpaceFixtureLimit = brief.perSpaceFixtureLimit ?? 6;
  const materialLimit = brief.materialLimit ?? 15;

  const session = getDriver().session();
  const bundleId = `bundle:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const warnings: string[] = [];

  try {
    // 1. Seeds
    const seeds = await session.run(
      `MATCH (c:Community {id: $c}), (s:Style {id: $s}), (p:PropertyType {id: $p})
       OPTIONAL MATCH (c)-[:HAS_CLIMATE]->(cl:ClimateProfile)
       RETURN c, s, p, cl`,
      { c: brief.community, s: brief.style, p: brief.propertyType }
    );
    if (seeds.records.length === 0) {
      throw new Error(
        `Missing seed nodes. Check that community=${brief.community}, style=${brief.style}, propertyType=${brief.propertyType} all exist.`
      );
    }
    const seed = seeds.records[0];
    const community = seed.get("c").properties;
    const style = seed.get("s").properties;
    const propertyType = seed.get("p").properties;
    const climate = seed.get("cl")?.properties;

    // 2. Palettes
    const palettesRes = await session.run(
      `MATCH (s:Style {id: $s})-[r:PREFERS_PALETTE]->(p:ColorPalette)
       RETURN p, r.weight AS w ORDER BY w DESC LIMIT 3`,
      { s: brief.style }
    );
    const palettes = palettesRes.records.map(r => {
      const p = r.get("p").properties;
      return { id: p.id, label: p.label, hex_values: p.hex_values ?? [] };
    });

    // 3. Cultural requirements relevant to this community
    const culturalRes = await session.run(
      `MATCH (cc:CulturalContext)-[:RELEVANT_TO]->(:Community {id: $c})
       OPTIONAL MATCH (cc)-[:REQUIRES_SPACE]->(sp:Space)
       RETURN cc, collect(DISTINCT sp.id) AS space_ids`,
      { c: brief.community }
    );
    const culturalRequirements = culturalRes.records.length
      ? {
          space_ids: culturalRes.records[0].get("space_ids") as string[],
          rules: (() => {
            const props = culturalRes.records[0].get("cc").properties;
            const raw = props.spatial_rules;
            if (Array.isArray(raw)) return raw as string[];
            if (typeof raw === "string") {
              try { return JSON.parse(raw) as string[]; } catch { return [raw]; }
            }
            return [];
          })(),
        }
      : { space_ids: [], rules: [] };

    // 4. Regulations
    const regsRes = await session.run(
      `MATCH (:Community {id: $c})-[:GOVERNED_BY]->(r:Regulation)
       RETURN r ORDER BY r.scope`,
      { c: brief.community }
    );
    const regulations: RegulationOut[] = regsRes.records.map(rec => {
      const r = rec.get("r").properties;
      return {
        id: r.id,
        label: r.label,
        scope: r.scope,
        rule_text: r.rule_text,
        approval_required: r.approval_required === true,
      };
    });

    // 5. Materials — style preference ∩ climate suitable ∩ community permitted.
    //    Score = style_weight * 0.5 + climate_fit * 0.3 + permitted * 0.2 * confidence.
    const matsRes = await session.run(
      `MATCH (s:Style {id: $s})-[pm:PREFERS_MATERIAL]->(m:Material)
       MATCH (m)-[perm:PERMITTED_IN]->(:Community {id: $c})
       OPTIONAL MATCH (m)-[sf:SUITED_FOR]->(:ClimateProfile {id: $cl})
       WITH m,
            pm.weight AS style_w,
            coalesce(sf.weight, 0.4) AS climate_w,
            perm.weight AS permit_w,
            (pm.confidence + perm.confidence + coalesce(sf.confidence, 0.5)) / 3.0 AS conf
       WITH m, (style_w * 0.5 + climate_w * 0.3 + permit_w * 0.2) * conf AS score
       RETURN m, score
       ORDER BY score DESC LIMIT $lim`,
      { s: brief.style, c: brief.community, cl: climate?.id ?? null, lim: neo4j.int(materialLimit) }
    );
    const materials: MaterialOut[] = matsRes.records.map(rec => {
      const m = rec.get("m").properties;
      return {
        id: m.id,
        label: m.label,
        category: m.category,
        surface: m.surface,
        color_hex: m.color_hex,
        score: round3(rec.get("score")),
      };
    });
    if (materials.length === 0) {
      warnings.push("No materials returned — check PREFERS_MATERIAL / PERMITTED_IN / SUITED_FOR edges for this slice.");
    }

    // 6. Spaces = property typology spaces UNION cultural-required spaces.
    const spacesRes = await session.run(
      `MATCH (:PropertyType {id: $p})-[:HAS_SPACE]->(sp:Space)
       RETURN DISTINCT sp
       UNION
       MATCH (sp:Space) WHERE sp.id IN $cultSpaceIds RETURN DISTINCT sp`,
      { p: brief.propertyType, cultSpaceIds: culturalRequirements.space_ids }
    );
    const spaceNodes = spacesRes.records.map(r => r.get("sp").properties);

    // 7. For each space, retrieve fixtures.
    const spaces: SpaceOut[] = [];
    for (const sp of spaceNodes) {
      const fxRes = await session.run(
        `MATCH (s:Style {id: $s})-[inc:INCLUDES_FIXTURE]->(f:Fixture)-[fs:FITS_SPACE]->(:Space {id: $sp})
         MATCH (v:Vendor) WHERE v.id = f.vendor_id AND v.price_tier IN $tiers
         WITH f, v, (inc.weight * 0.6 + fs.weight * 0.4) AS score
         RETURN f, v, score
         ORDER BY score DESC LIMIT $lim`,
        { s: brief.style, sp: sp.id, tiers: budgetTiers, lim: neo4j.int(perSpaceFixtureLimit) }
      );
      const fixtures: FixtureOut[] = fxRes.records.map(rec => {
        const f = rec.get("f").properties;
        const v = rec.get("v").properties;
        return {
          id: f.id,
          label: f.label,
          sub_category: f.sub_category,
          vendor: v.label,
          vendor_id: v.id,
          price_aed: f.price_aed?.toNumber ? f.price_aed.toNumber() : f.price_aed,
          lead_time_days: f.lead_time_days?.toNumber ? f.lead_time_days.toNumber() : f.lead_time_days,
          score: round3(rec.get("score")),
        };
      });
      const typical = parseArrayMaybe<number>(sp.typical_area_sqm_range);
      spaces.push({
        id: sp.id,
        label: sp.label,
        category: sp.category,
        typical_area_sqm_range: typical,
        fixtures,
      });
      if (fixtures.length === 0) {
        warnings.push(`No fixtures for space '${sp.label}' under budget tiers [${budgetTiers.join(", ")}].`);
      }
    }

    return {
      bundleId,
      brief,
      community: {
        id: community.id,
        label: community.label,
        sub_communities: parseArrayMaybe<string>(community.sub_communities),
      },
      style: {
        id: style.id,
        label: style.label,
        key_traits: parseArrayMaybe<string>(style.key_traits),
      },
      propertyType: {
        id: propertyType.id,
        label: propertyType.label,
        bedrooms: numberish(propertyType.bedrooms),
        gfa_sqm: numberish(propertyType.gfa_sqm),
      },
      palettes,
      climate: climate
        ? {
            id: climate.id,
            label: climate.label,
            constraints: parseArrayMaybe<string>(climate.constraints) ?? [],
          }
        : undefined,
      culturalRequirements,
      regulations,
      materials,
      spaces,
      warnings,
    };
  } finally {
    await session.close();
  }
}

// ---------- formatting for prompt injection ----------
export function formatBundleForPrompt(b: ContextBundle): string {
  const lines: string[] = [];
  lines.push("## Retrieved design context (from RennovAIte KG)");
  lines.push("");
  lines.push(`**Project:** ${b.propertyType.label} in ${b.community.label}, ${b.style.label} style.`);
  if (b.style.key_traits?.length) {
    lines.push(`**Style traits:** ${b.style.key_traits.join("; ")}.`);
  }
  if (b.palettes.length) {
    lines.push(`**Preferred palettes:** ` +
      b.palettes.map(p => `${p.label} (${p.hex_values.join(", ")})`).join(" | "));
  }
  if (b.climate) {
    lines.push(`**Climate constraints:** ${b.climate.constraints.join("; ")}.`);
  }
  if (b.culturalRequirements.rules.length) {
    lines.push(`**Cultural / program rules:** ${b.culturalRequirements.rules.join("; ")}.`);
  }
  if (b.regulations.length) {
    lines.push("");
    lines.push("**Community regulations (must comply):**");
    for (const r of b.regulations) {
      lines.push(`- [${r.scope}] ${r.label}: ${r.rule_text}`);
    }
  }
  lines.push("");
  lines.push("**Recommended materials (ranked):**");
  for (const m of b.materials) {
    lines.push(`- ${m.label} (${m.category}${m.surface ? `, ${m.surface}` : ""}${m.color_hex ? `, ${m.color_hex}` : ""}) — score ${m.score}`);
  }
  lines.push("");
  lines.push("**Per-space fixture shortlist (vendor, AED, lead-time days):**");
  for (const sp of b.spaces) {
    lines.push(`- ${sp.label} (${sp.category})${sp.typical_area_sqm_range ? ` — typical ${sp.typical_area_sqm_range[0]}–${sp.typical_area_sqm_range[1]} sqm` : ""}`);
    for (const f of sp.fixtures) {
      const price = f.price_aed != null ? `AED ${f.price_aed}` : "AED —";
      const lead = f.lead_time_days != null ? `${f.lead_time_days}d` : "—";
      lines.push(`  • ${f.label} — ${f.vendor}, ${price}, ${lead}`);
    }
  }
  if (b.warnings.length) {
    lines.push("");
    lines.push(`_KG warnings: ${b.warnings.join(" | ")}_`);
  }
  lines.push("");
  lines.push(`_(retrieval bundle id: ${b.bundleId} — record this against any user feedback)_`);
  return lines.join("\n");
}

// ---------- helpers ----------
function round3(v: any): number {
  const n = typeof v === "number" ? v : (v?.toNumber ? v.toNumber() : Number(v));
  return Math.round(n * 1000) / 1000;
}
function numberish(v: any): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (v?.toNumber) return v.toNumber();
  return Number(v);
}
function parseArrayMaybe<T>(v: any): T[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  return undefined;
}
