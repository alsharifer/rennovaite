// =============================================================================
// lib/parse/providers/index.ts — provider selection via PARSE_PROVIDER.
//
// Default is the in-house Claude-vision parser. The hosted raster→vector
// adapter (CubiCasa) is S4b — deferred until a provider key + image-ingest
// confirmation, so selecting it today throws rather than silently mis-parsing.
// =============================================================================

import { inhouseProvider } from "./inhouse";
import type { ParseProvider } from "./types";

export function getParseProvider(): ParseProvider {
  const name = process.env.PARSE_PROVIDER ?? "inhouse";
  if (name === "inhouse") return inhouseProvider;
  // TODO(S4b): hosted raster→vector adapter (CubiCasa) — needs a key + a
  // confirmed image-ingest path, plus the upload consent line.
  throw new Error(
    `PARSE_PROVIDER="${name}" is not configured. Only "inhouse" is available today; the hosted adapter is S4b.`,
  );
}

export type { ParseAsset, ParseProvider, RawParseResult, RawParsedRoom } from "./types";
