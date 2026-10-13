#!/usr/bin/env node
// =============================================================================
// scripts/k10-icons-cold-shots.mjs — K10 #6 live: a COLD load on throttled
// "Slow 4G" (DevTools' profile: 1.6 Mbps down, 750 kbps up, 562.5 ms RTT;
// cache disabled) never shows an icon's ligature text.
//
//   node --env-file=.env.local scripts/k10-icons-cold-shots.mjs [port] [--shots=screenshots/k10/icons]
//
// Samples the page every 250 ms while it loads: until <html data-icons="ready">
// every icon must be transparent; once ready, the self-hosted subset must be
// the face in use (document.fonts reports it loaded) and no icon box wider than
// its glyph. Screenshots: the earliest sample with icons in the DOM, and the
// settled page. Read-only (a signed-in dev account's own Projects home).
// =============================================================================

import { openBrowser } from "./lib/cdp.mjs";

const PORT = /^\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : "3098";
const BASE = `http://localhost:${PORT}`;
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) ?? "--shots=screenshots/k10/icons").slice(8);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE = `(() => {
  const icons = [...document.querySelectorAll(".bp-icon, .material-symbols-outlined")];
  const ready = document.documentElement.getAttribute("data-icons") === "ready";
  const visibleText = icons.filter((i) => { const c = getComputedStyle(i).color; return !/rgba\\(\\s*0,\\s*0,\\s*0,\\s*0\\s*\\)|transparent/.test(c); }).length;
  const wide = icons.filter((i) => { const r = i.getBoundingClientRect(); return r.width > parseFloat(getComputedStyle(i).fontSize) + 0.5; }).length;
  const face = [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Material Symbols Sharp").map((f) => f.status);
  return { n: icons.length, ready, visibleText, wide, face, fontReq: performance.getEntriesByType("resource").filter((e) => /material-symbols|fonts\\.g/.test(e.name)).map((e) => e.name.replace(location.origin, "")) };
})()`;

// Warm the dev server (it compiles on first request) so the cold load measures the network, not the build.
{
  const w = await openBrowser({ who: "pipeline", script: "k10-icons-cold-shots" });
  await w.goto(`${BASE}/projects`, "[data-home]");
  await w.close();
}

for (const theme of ["light", "dark"]) {
  const b = await openBrowser({ who: "pipeline", script: "k10-icons-cold-shots" });
  try {
    await b.viewport(1440, 1000);
    await b.send("Network.enable");
    await b.send("Network.setCacheDisabled", { cacheDisabled: true });
    await b.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (750 * 1024) / 8 * 0.9 });
    await b.send("Network.setCookie", { name: "rv_theme", value: theme, domain: "localhost", path: "/" });
    await b.send("Page.navigate", { url: `${BASE}/projects` });
    const samples = [];
    let early = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await sleep(250);
      let s;
      try {
        s = await b.evaluate(SAMPLE);
      } catch {
        continue;
      }
      samples.push({ t: Date.now() - t0, ...s });
      if (!early && s.n > 0 && !s.ready) {
        await b.screenshot(`${SHOTS}/${theme}-1-before-font.png`);
        early = true;
      }
      if (s.ready && s.n > 0 && (await b.evaluate("document.readyState")) === "complete") break;
    }
    const before = samples.filter((s) => s.n > 0 && !s.ready);
    const last = samples.at(-1);
    check(`${theme}: icons were in the DOM before the font arrived (the case under test)`, before.length > 0, `${before.length} samples · font ready at ${last?.t} ms`);
    check(`${theme}: no icon's ligature text was ever visible before the font`, before.every((s) => s.visibleText === 0), JSON.stringify(before.filter((s) => s.visibleText).slice(0, 2)));
    check(`${theme}: no icon box ever wider than its glyph`, samples.every((s) => s.wide === 0), JSON.stringify(samples.filter((s) => s.wide).slice(0, 2)));
    check(`${theme}: the font ends loaded and the icons visible`, !!last?.ready && last.face.includes("loaded") && last.visibleText === last.n, JSON.stringify({ ready: last?.ready, face: last?.face, visible: last?.visibleText, n: last?.n }));
    check(`${theme}: the font came from this app (/fonts/…), never Google`, (last?.fontReq ?? []).length > 0 && last.fontReq.every((u) => u.startsWith("/fonts/material-symbols-sharp.woff2")), JSON.stringify(last?.fontReq));
    await b.screenshot(`${SHOTS}/${theme}-2-loaded.png`);
  } finally {
    await b.close();
  }
}
console.log(failures === 0 ? "\nALL K10 ICON COLD-LOAD CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
