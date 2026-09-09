// =============================================================================
// scripts/_target-guard.mjs — say which database you are about to write to (I8).
//
// Every seed and maintenance script reads NEXT_PUBLIC_SUPABASE_URL and writes
// wherever it points. That was safe while there was one database. With a dev
// project it stops being safe, because the difference between "seeding dev" and
// "overwriting production" is one stale shell variable.
//
// So: resolve the project ref, print it, and refuse to write to PRODUCTION
// unless the caller says so explicitly. The guard is deliberately loud even
// when it allows the write — a script that silently targets prod is the thing
// being prevented.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

/** The production project. Hard-coded on purpose: a guard that reads its own
 *  limit from the environment it is guarding protects nothing. */
export const PRODUCTION_REF = "efrcgktrlsjnzkzzuhof";

export function readEnvFile(file = ".env.local", root = process.cwd()) {
  const p = path.join(root, file);
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Project ref from a Supabase URL: https://<ref>.supabase.co */
export function refFromUrl(url) {
  if (!url) return null;
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\./i.exec(url);
  return m ? m[1] : null;
}

export function isProduction(url) {
  return refFromUrl(url) === PRODUCTION_REF;
}

/**
 * Resolve the target and enforce the rule.
 *
 * @param {object} opts
 * @param {string} opts.script    name, for the message
 * @param {boolean} opts.writes   true if this script mutates data
 * @returns {{ url: string, key: string, ref: string, isProd: boolean }}
 */
export function resolveTarget({ script, writes = true } = {}) {
  const env = { ...readEnvFile(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
        "(.env.local or the environment).",
    );
  }
  const ref = refFromUrl(url);
  const prod = ref === PRODUCTION_REF;

  const banner = prod
    ? `!! PRODUCTION (${ref}) !!`
    : `dev / non-production (${ref})`;
  console.log(`[${script}] target: ${banner}`);

  if (prod && writes && process.env.ALLOW_PROD_WRITE !== "1") {
    console.error(
      `\n[${script}] REFUSING TO WRITE TO PRODUCTION.\n\n` +
        `  Project ref ${ref} is production.\n` +
        `  If you genuinely mean to write there, re-run with:\n\n` +
        `      ALLOW_PROD_WRITE=1 <command>\n\n` +
        `  If you meant dev, point NEXT_PUBLIC_SUPABASE_URL and\n` +
        `  SUPABASE_SERVICE_ROLE_KEY at the dev project first.\n`,
    );
    process.exit(1);
  }

  return { url, key, ref, isProd: prod };
}
