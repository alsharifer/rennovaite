// =============================================================================
// scripts/k8-email-shots.mjs — the auth e-mail templates (K8 #18, 69:1422 /
// 69:1438) filled with sample values and screenshotted in headless Chrome, at
// desktop width and on a phone. (They carry no dark styles at all: color-scheme
// light, explicit colours — a client cannot turn them dark.)
// Pure: no server, no database, no e-mail sent.
//
//   node --env-file=.env.local scripts/k8-email-shots.mjs [outDir]
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { openBrowser } from "./lib/cdp.mjs";

const out = process.argv[2] ?? "screenshots/k8/18-emails";
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k8-email-"));
const fill = (html, data = {}) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replaceAll("{{ .ConfirmationURL }}", "https://rennovaite.fit/auth/v1/verify?token=••••••&type=magiclink")
    .replaceAll("{{ .Email }}", "sample.owner@example.com")
    // The invite's Go-template conditionals, resolved with the sample data.
    .replace(/\{\{ if \.Data\.invited_by \}\}\{\{ \.Data\.invited_by \}\}\{\{ if \.Data\.firm \}\} from \{\{ \.Data\.firm \}\}\{\{ end \}\} added you\{\{ else \}\}You have been added\{\{ end \}\}/, data.invited_by ? `${data.invited_by}${data.firm ? ` from ${data.firm}` : ""} added you` : "You have been added")
    .replace(/\{\{ if \.Data\.project_name \}\}\{\{ \.Data\.project_name \}\}\{\{ else \}\}a project\{\{ end \}\}/, data.project_name ?? "a project");

const pages = [
  ["magic-link", fill(fs.readFileSync("supabase/templates/magic-link.html", "utf8"))],
  ["invite", fill(fs.readFileSync("supabase/templates/invite.html", "utf8"), { invited_by: "Sample Owner", firm: "Scratch Landscapes & Co.", project_name: "Garden — Draft for Review" })],
];
const b = await openBrowser({ script: "k8-email-shots" });
try {
  for (const [name, html] of pages) {
    if (/\{\{/.test(html)) throw new Error(`${name}: an unfilled template variable`);
    const file = path.join(tmp, `${name}.html`);
    fs.writeFileSync(file, html);
    for (const [size, w, h] of [["desktop", 760, 900], ["phone", 390, 900]]) {
      await b.viewport(w, h);
      await b.goto(pathToFileURL(file).href, "table");
      await b.screenshot(path.join(out, `${name}-${size}.png`), { fullPage: true });
      console.log(`ok   ${name}-${size}`);
    }
  }
} finally {
  await b.close();
}
