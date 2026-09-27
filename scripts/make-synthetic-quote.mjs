#!/usr/bin/env node
// =============================================================================
// scripts/make-synthetic-quote.mjs — the ONE quotation fixture (U3).
//
//   node --import ./scripts/_alias-hook.mjs scripts/make-synthetic-quote.mjs
//
// Writes lib/quotes/__fixtures__/synthetic-quote.xlsx with the writer the app
// uses, deterministically: eight rows covering every path the importer has —
// a key given, descriptions that match, one in another currency, one with an
// unreadable rate, one that matches nothing. Entirely invented: no supplier,
// no real price list. Real supplier documents never enter the repository; if
// one is ever needed locally it lives outside the tree and only its sha256 is
// recorded (docs/AUTH.md → Quotes).
// =============================================================================
import fs from "node:fs";
import { createHash } from "node:crypto";

import { writeXlsx } from "../lib/quotes/xlsx.ts";

export const SYNTHETIC_QUOTE_ROWS = [
  ["item_key", "description", "qty", "unit", "rate", "currency"],
  ["garden.pcc_base", "PCC base 100mm under paving", 64, "m2", 98.5, "AED"],
  ["", "Porcelain floor tile 600x600 supply only", 120, "m2", 145, "AED"],
  ["", "Artificial grass supply (35mm)", 50, "m2", 82, "AED"],
  ["", "Aluminium louvred pergola 3.5 x 3.5 m", 1, "no", 24500, "AED"],
  ["", "Wall plaster and skim coat", 300, "m2", 48, "AED"],
  ["", "Boundary wall lights, IP65", 6, "no", 95, "USD"],
  ["", "Irrigation controller programming", 1, "lump", "on request", "AED"],
  ["", "Site sign board 2 x 1 m", 1, "no", 1200, "AED"],
];

const out = "lib/quotes/__fixtures__/synthetic-quote.xlsx";
fs.mkdirSync("lib/quotes/__fixtures__", { recursive: true });
const bytes = writeXlsx([{ name: "Quote", rows: SYNTHETIC_QUOTE_ROWS }]);
fs.writeFileSync(out, bytes);
console.log(`${out}  ${bytes.length} bytes  sha256=${createHash("sha256").update(bytes).digest("hex")}`);
