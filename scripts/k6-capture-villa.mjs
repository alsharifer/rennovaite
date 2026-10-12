// =============================================================================
// scripts/k6-capture-villa.mjs — capture the sign-in design view (K6, R7
// §3.9a) from our own three.js stage (/dev/villa-orbit): a 10 s seamless orbit
// as WebM (VP9) and MP4 (H.264), each ≤ 2 MB, and a poster frame (WebP + JPEG).
//
//   node scripts/k6-capture-villa.mjs [port]
//
// MediaRecorder in a headless Chrome (SwiftShader WebGL) — no ffmpeg needed.
// The orbit is periodic over 10 s, so a 10 s recording loops seamlessly from
// whatever phase it starts at. Writes public/design-view/villa-orbit.{webm,mp4} and
// villa-orbit-poster.{webp,jpg}. Fails if a file is over budget.
// =============================================================================

import fs from "node:fs";

import { openBrowser } from "./lib/cdp.mjs";

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3098);
const OUT = "public/design-view";
const BUDGET = 2 * 1024 * 1024;
fs.mkdirSync(OUT, { recursive: true });

const b = await openBrowser({ script: "k6-capture-villa", args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let failures = 0;
try {
  await b.viewport(1280, 900);
  await b.goto(`http://localhost:${port}/dev/villa-orbit`, "[data-villa-orbit] canvas");
  if (!(await b.until("window.__villaOrbit?.ready === true", 30000))) throw new Error("the stage did not render (no WebGL?)");

  const record = (mime) =>
    b.evaluate(`(async () => {
      if (!MediaRecorder.isTypeSupported(${JSON.stringify(mime)})) return { error: "unsupported" };
      const stream = window.__villaOrbit.canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: ${JSON.stringify(mime)}, videoBitsPerSecond: 1100000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(1000);
      await new Promise((r) => setTimeout(r, 10000));
      rec.stop();
      await stopped;
      const buf = new Uint8Array(await new Blob(chunks, { type: ${JSON.stringify(mime)} }).arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(s), bytes: buf.length };
    })()`);

  for (const [ext, mime] of [
    ["webm", "video/webm;codecs=vp9"],
    ["mp4", "video/mp4;codecs=avc1.42E01E"],
  ]) {
    const r = await record(mime);
    if (r.error) {
      console.log(`  FAIL  ${ext}: ${mime} ${r.error} in this Chrome`);
      failures++;
      continue;
    }
    fs.writeFileSync(`${OUT}/villa-orbit.${ext}`, Buffer.from(r.b64, "base64"));
    const ok = r.bytes <= BUDGET;
    if (!ok) failures++;
    console.log(`${ok ? "  ok " : "  FAIL"}  villa-orbit.${ext}  ${(r.bytes / 1024).toFixed(0)} KB (budget 2,048 KB)`);
  }

  // The poster: the orbit's first frame, held still.
  await b.goto(`http://localhost:${port}/dev/villa-orbit?still`, "[data-villa-orbit] canvas");
  await b.until("window.__villaOrbit?.ready === true", 30000);
  for (const [ext, type, q] of [
    ["webp", "image/webp", 0.82],
    ["jpg", "image/jpeg", 0.82],
  ]) {
    const url = await b.evaluate(`(window.__villaOrbit.frame(0), window.__villaOrbit.canvas.toDataURL(${JSON.stringify(type)}, ${q}))`);
    const buf = Buffer.from(url.split(",")[1], "base64");
    fs.writeFileSync(`${OUT}/villa-orbit-poster.${ext}`, buf);
    console.log(`  ok   villa-orbit-poster.${ext}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await b.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nCAPTURED");
process.exit(failures ? 1 : 0);
