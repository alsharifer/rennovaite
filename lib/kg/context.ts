/**
 * Safe KG retrieval helper — the single guardrail that keeps the demo alive
 * when Neo4j is down, slow, or unseeded.
 *
 * `getKgContext` NEVER throws. It returns an empty fallback
 * (`{ context: "", bundleId: null }`) when:
 *   - the `KG_ENABLED` flag is not exactly "true", or
 *   - the style key has no KG mapping (resolveBrief → null), or
 *   - retrieval errors, times out, or comes back empty.
 *
 * Callers append `context` to their model prompt only when it is non-empty and
 * persist `bundleId` against the resulting row for the feedback loop.
 */
import {
  formatBundleForPrompt,
  retrieveContextBundle,
} from "@/kg/retrieval/agent";
import { resolveBrief } from "@/lib/kg/brief";

// Keep this well under the route's own Replicate / Anthropic timeouts (90s /
// 120s) so a hung Neo4j never blocks the actual render / BoQ generation. Warm
// retrieval is ~0.7s; the headroom is for the first (cold) bolt connection in a
// fresh server process.
const KG_TIMEOUT_MS = 10_000;

type ProjectLike = {
  id?: string | null;
  name?: string | null;
  city?: string | null;
} | null;

export type GetKgContextArgs = {
  styleKey: string | null | undefined;
  project: ProjectLike;
};

export type KgContextResult = {
  context: string;
  bundleId: string | null;
};

const EMPTY: KgContextResult = { context: "", bundleId: null };

export async function getKgContext(
  args: GetKgContextArgs,
): Promise<KgContextResult> {
  if (process.env.KG_ENABLED !== "true") return EMPTY;

  const brief = resolveBrief({ styleKey: args.styleKey, project: args.project });
  if (!brief) return EMPTY;

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`KG retrieval timed out after ${KG_TIMEOUT_MS}ms`)),
        KG_TIMEOUT_MS,
      );
    });

    const bundle = await Promise.race([
      retrieveContextBundle(brief),
      timeoutPromise,
    ]);

    const context = formatBundleForPrompt(bundle);
    if (!context.trim()) return EMPTY;

    return { context, bundleId: bundle.bundleId };
  } catch (err) {
    console.warn(
      "[lib/kg] KG retrieval failed — proceeding without grounding:",
      err instanceof Error ? err.message : err,
    );
    return EMPTY;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
