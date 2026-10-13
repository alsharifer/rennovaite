// =============================================================================
// scripts/k8-viewer-check.mjs — the 3D view, driven by keyboard (K8 #9).
// READ ONLY: the dev demo villa is visited, never written.
//
//   node --env-file=.env.local scripts/k8-viewer-check.mjs [port] [project]
//
// The rail keeps the step you came from (visit 05 Timeline, then the 3D view:
// Timeline stays lit and the top bar says "Back to timeline"); a room label is
// a button — focus it, press Enter → the inspector names the room with its
// facts, each figure with its mark, "Render this room" → /render?room=<id>,
// "Show on plan" → /plan?room=<id>; Section and Measure are toggles
// (aria-pressed); the inspector closes and reopens.
// =============================================================================

import { openBrowser } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const port = args.find((a) => /^\d+$/.test(a)) ?? "3098";
const project = args.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? "6b5fda9d-e40f-4e16-940c-7a17d27ec5dc";
const base = `http://localhost:${port}`;

let failures = 0;
const check = (l, ok, d = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "  FAIL"}  ${l}${d ? `  — ${d}` : ""}`);
};

const b = await openBrowser({ script: "k8-viewer-check" });
const P = `${base}/project/${project}`;
const pressed = (name) => `[...document.querySelectorAll("[data-viewer] [role=toolbar] button")].find((x) => x.textContent.trim().endsWith(${JSON.stringify(name)}))?.getAttribute("aria-pressed")`;
const click = (name) => `[...document.querySelectorAll("[data-viewer] [role=toolbar] button")].find((x) => x.textContent.trim().endsWith(${JSON.stringify(name)})).click()`;
try {
  console.log("1. The rail keeps the step you came from");
  await b.goto(`${P}/timeline`, "[data-timeline]");
  await b.goto(`${P}/viewer`, "[data-viewer]");
  await b.until(`!!document.querySelector("[data-viewer] [role=toolbar]")`, 15000);
  const lit = await b.evaluate(`document.querySelector("nav [aria-current=step], nav [aria-current=page]")?.textContent ?? null`);
  check("05 Timeline stays lit on the 3D view", /Timeline/.test(lit ?? ""), lit ?? "none");
  const back = await b.evaluate(`[...document.querySelectorAll("a")].find((a) => /^Back to /.test(a.textContent.trim()))?.textContent.trim() ?? null`);
  check("the top bar goes back to it", back === "Back to timeline", back ?? "none");
  const crumb = await b.evaluate(`document.body.innerText.includes("3D view")`);
  check("the breadcrumb names the 3D view", crumb);

  console.log("2. Inspect a room from the keyboard");
  await b.until(`document.querySelectorAll("[data-viewer] button[aria-pressed][class*=font-bp-mono]").length > 0`, 20000);
  const label = await b.evaluate(`(() => { const x = document.querySelector("[data-viewer] button[aria-pressed][class*=font-bp-mono]"); x.focus(); return x.textContent; })()`);
  await b.key("Enter");
  await b.until(`document.getElementById("inspect-h")?.textContent !== "Nothing selected"`, 4000).catch(() => {});
  const title = await b.evaluate(`document.getElementById("inspect-h")?.textContent`);
  check("Enter on a label inspects that room", label.startsWith(title), `${label} → ${title}`);
  check("the label shows it is selected", (await b.evaluate(`document.activeElement?.getAttribute("aria-pressed") ?? document.querySelector("[data-viewer] button[aria-pressed=true][class*=font-bp-mono]")?.getAttribute("aria-pressed")`)) === "true");
  const rows = await b.evaluate(`[...document.querySelectorAll("[data-viewer-inspector] dt")].map((d) => d.textContent)`);
  check("the room's facts are listed", ["Floor area", "Walls", "Perimeter"].every((r) => rows.includes(r)), rows.join(", "));
  const marks = await b.evaluate(`[...document.querySelectorAll("[data-viewer-inspector] dd .sr-only")].map((s) => s.textContent)`);
  check("each measured figure carries its mark", marks.length >= 2 && marks.every((m) => /, (measured|estimated)$/.test(m)), marks.join(" | "));
  const links = await b.evaluate(`Object.fromEntries([...document.querySelectorAll("[data-viewer-inspector] a")].filter((a) => /this room|on plan/.test(a.textContent)).map((a) => [a.textContent.trim(), a.getAttribute("href")]))`);
  check("Render this room opens that room in Renders", /\/render\?room=[0-9a-f-]{36}$/.test(links["Render this room"] ?? ""), links["Render this room"]);
  check("Show on plan selects it on the plan", /\/plan\?room=[0-9a-f-]{36}$/.test(links["Show on plan"] ?? ""), links["Show on plan"]);

  console.log("3. Tools");
  check("Inspect is on", (await b.evaluate(pressed("Inspect"))) === "true");
  await b.evaluate(click("Section"));
  check("Section toggles", (await b.evaluate(pressed("Section"))) === "true" && (await b.evaluate(`document.querySelector("[data-viewer]").hasAttribute("data-viewer-section")`)));
  await b.evaluate(click("Measure"));
  check("Measure toggles and says how", (await b.evaluate(pressed("Measure"))) === "true" && (await b.evaluate(`document.body.innerText.includes("Click two points to measure")`)));
  await b.evaluate(click("Measure"));
  await b.evaluate(click("Walk"));
  check("Walk is a camera choice", (await b.evaluate(pressed("Walk"))) === "true" && (await b.evaluate(pressed("Orbit"))) === "false");
  await b.evaluate(click("Orbit"));
  await b.evaluate(`document.querySelector("[data-viewer-inspector] button[aria-label='Close the inspector']").click()`);
  await b.until(`!document.querySelector("[data-viewer-inspector]")`, 3000).catch(() => {});
  check("the inspector closes", !(await b.evaluate(`!!document.querySelector("[data-viewer-inspector]")`)));
  await b.evaluate(click("Inspect"));
  check("…and Inspect reopens it", await b.evaluate(`!!document.querySelector("[data-viewer-inspector]")`));
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
