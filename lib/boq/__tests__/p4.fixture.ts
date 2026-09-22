// Shared fixtures for the P4 element-mapping path (the viewer-flag path).
import { buildPlanGraph } from "@/lib/plan/geometry";
import { MUDON_FIXTURE } from "@/lib/plan/__tests__/mudon.fixture";

import { generateDeterministicBoq } from "../engine";
import { MUDON_FIRST_FLOOR } from "../fixtures/mudon-first-floor";
import { quantifyPlan } from "../quantify";
import { LABOUR_RATES_FIXTURE } from "./labour-rates.fixture";
import { PRICING_SKUS_FIXTURE } from "./pricing-skus.fixture";

/** The Mudon plan's element take-off (quantifyPlan over the committed plan fixture). */
export function mudonTakeoff() {
  return quantifyPlan(buildPlanGraph(MUDON_FIXTURE));
}

/** The Mudon engine BoQ at the mid tier. */
export function mudonEngineBoq() {
  return generateDeterministicBoq({
    rooms: MUDON_FIRST_FLOOR,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labourRates: LABOUR_RATES_FIXTURE as any,
    skus: PRICING_SKUS_FIXTURE,
    styleKey: "contemporary-majlis",
  }).boq;
}
