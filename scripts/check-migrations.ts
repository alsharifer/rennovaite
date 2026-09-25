// CLI wrapper. The logic lives in lib/migrations/history.ts so the test and
// this script share one module in one format.
//
// Run: node --import ./scripts/_alias-hook.mjs scripts/check-migrations.ts
import { checkFrozenMirror, checkMigrations } from "../lib/migrations/history.ts";

const { checked, errors, untracked } = checkMigrations();
console.log(`checked ${checked} migrations against the manifest`);

// T6: the frozen mirror stays a record — one live source of truth.
const mirror = checkFrozenMirror();
console.log(`frozen mirror: ${mirror.frozen.length} historical files, all mapped into the live directory`);
errors.push(...mirror.errors);

if (untracked.length > 0) {
  console.log(
    `\n${untracked.length} migration(s) not yet in the manifest:\n` +
      untracked.map((f) => `  + ${f}`).join("\n") +
      `\n\nAdd them with:  npm run db:manifest`,
  );
}

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s):\n\n${errors.join("\n\n")}`);
  process.exit(1);
}
console.log("history intact — no migration has been edited or removed");
