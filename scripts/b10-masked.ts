// =============================================================================
// scripts/b10-masked.ts — bathroom pilot B10: masked per-fixture edits.
//
//   node --env-file=.env.local --experimental-transform-types --import ./scripts/_alias-hook.mjs \
//     scripts/b10-masked.ts [--replay] [--masked] [--control]
//
// HARD CAP US$5.00 for the whole session (renders + readings), enforced in code
// before every paid call (lib/render/spend-cap.ts, session_ref "b10"): a call
// whose worst case would cross it is refused, and the run stops and reports.
//
//   --replay   (b) the client's Photo 2 comments, replayed from v4 (the version
//              they were made on) as masked edits: a cabinet where the bidet was,
//              one fixed glass panel, a ceramic top, the hand spray off the wall.
//              Each edit is judged like "Ask for a change" (the placement check
//              against its parent, and "was the request done"); a failed one is
//              tried once more. Counted against B6: 16 edits, 10 kept.
//   --masked   (a) P1 and P3 restyled as masked edits: the room's shell with every
//              fixture masked out, then each fixture inside its own box.
//   --control  (a) the control arm: today's pipeline with the vanity's size stated
//              in the prompt (two attempts) — expected to fail; run to close the question.
//
// Scored with the calibrated check (B8: two readings, measured tolerances).
// Writes data/Bathroom Pilot/b10-eval/ (gitignored: client photos) + results.json.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

import { checkCostUsd, detectAgreed, itemsNamedBy, judgePhotoPlacement, type Box, type CheckItem, type Detection, type Located } from "@/lib/render/photo-check";
import { maskedEdit, maskPng, padBox, raiseBox, raiseToTop } from "@/lib/render/masked-edit";
import { restyleWithCheck, styleElementsFor } from "@/lib/render/photo-restyle";
import { checkFollows, describeChange } from "@/lib/render/room-spec";
import { fittingNotes } from "@/lib/render/fitting-notes";
import { IMAGE_PRICE_USD, type SpendRow } from "@/lib/render/render-spend";
import { SpendCap, SpendCapReached, WORST_CASE_USD } from "@/lib/render/spend-cap";
import { imageSize } from "@/lib/scene-render/gate";

import { bytesOf, img, loadB8Context, P } from "./lib/b8-context";

const OUT = "data/Bathroom Pilot/b10-eval";
fs.mkdirSync(OUT, { recursive: true });
const RESULTS = path.join(OUT, "results.json");
const results: Record<string, unknown> = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : {};
const save = () => fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1));

const ctx = await loadB8Context("b10-masked");
const { db, views, current, anchor } = ctx;
const cap = new SpendCap(db, P, "b10", 5);
const items = current.items;
const readings = JSON.parse(fs.readFileSync("data/Bathroom Pilot/b8-eval/readings.json", "utf8")) as Record<string, { detection: Detection }>;
const finish = (re: RegExp, fallback: string) => anchor?.style.elements?.find((e) => re.test(e.element.toLowerCase()))?.finish ?? fallback;
const boxOf = (d: { items: Located[] }, ref: string) => d.items.find((l) => l.ref === ref && l.present && l.box)?.box ?? null;
const itemOf = (kind: CheckItem["kind"]) => items.find((i) => i.kind === kind && !i.gone)!;
const spendRow = (model: string, usd: number, step: string): SpendRow => ({ project_id: P, purpose: "eval", model, cost_usd: usd, detail: { step } });

// --- paid calls, every one under the cap ------------------------------------------------
const read = (bytes: Uint8Array, role: "before" | "after", reference?: { bytes: Uint8Array; located: Located[] }) =>
  cap.run(`an agreed reading (${role})`, WORST_CASE_USD.reading, async () => {
    const d = await detectAgreed(img(bytes), items, role, imageSize(bytes), reference ? { image: img(reference.bytes), located: reference.located } : undefined);
    return { value: d, spend: [spendRow(d.model, checkCostUsd(d.usage), "b10_reading")] };
  });
const fill = (image: Uint8Array, mask: Buffer, prompt: string, step: string) =>
  cap.run(`a masked edit (${step})`, WORST_CASE_USD["black-forest-labs/flux-fill-pro"], async () => {
    const r = await maskedEdit(image, mask, prompt);
    return { value: new Uint8Array(r.bytes), spend: [spendRow(r.model, IMAGE_PRICE_USD[r.model] ?? 0.05, `b10_fill:${step}`)] };
  });
const describe = (before: Uint8Array, after: Uint8Array, request: string) =>
  cap.run("a change description", WORST_CASE_USD.check, async () => {
    const r = await describeChange(img(before), img(after), request);
    return { value: r, spend: [spendRow("claude-opus-5-5", checkCostUsd(r.usage), "b10_describe")] };
  });
const follows = (bytes: Uint8Array, kinds: Set<CheckItem["kind"]>) =>
  cap.run("a follows check", WORST_CASE_USD.check, async () => {
    const r = await checkFollows(img(bytes), img(anchor!.bytes), styleElementsFor(anchor!.style, kinds));
    return { value: r, spend: [spendRow("claude-opus-5-5", checkCostUsd(r.usage), "b10_follows")] };
  });

const ratio = (b: Box | null, a: Box | null) => (b && a ? Math.round((((a[2] - a[0]) * (a[3] - a[1])) / ((b[2] - b[0]) * (b[3] - b[1]))) * 100) / 100 : null);
const STYLE = "Photorealistic interior photograph, warm 2700 K light, the same camera and perspective as the rest of the image.";

try {
  // --- (b) the client's Photo 2 comments, replayed as masked edits --------------------------
  if (process.argv.includes("--replay") && !results.replay) {
    const v4 = new Uint8Array(fs.readFileSync(path.join(OUT, "v4.jpg")));
    let parent = v4;
    let parentRead = await read(v4, "before");
    const cab = itemOf("cabinet"), glass = itemOf("shower"), vanity = itemOf("vanity");
    // A replacement is raised to its stated height on the wall (raiseToTop), not by a guess.
    const cabTop = cab.top_share ?? 0.43;
    const comments: { key: string; request: string; prompt: string; box: (d: Detection) => Box | null }[] = [
      { key: "cabinet", request: "Replace the bidet with a white floor-standing storage cabinet, about 1.2 m tall, in the same spot.", prompt: `A white floor-standing bathroom storage cabinet about 1.2 m tall, plain flat doors, standing on the floor exactly here; no bidet. The wall and floor around it are as in the rest of the image. ${STYLE}`, box: (d) => { const b = boxOf(d, cab.ref); return b ? raiseToTop(b, d.items.find((l) => l.ref === cab.ref)?.top, cabTop) : null; } },
      { key: "fixed_panel", request: "Make the shower glass one fixed frameless clear glass panel — no hinged door, no second panel.", prompt: `One fixed frameless clear glass shower panel with a slim ${finish(/fitting|brass|tap/, "brushed brass")} wall profile and a stay bar; no hinged glass door, no second panel; the shower and its tiles visible through the clear glass. ${STYLE}`, box: (d) => boxOf(d, glass.ref) },
      { key: "ceramic_top", request: "Change the vanity counter to a white ceramic top with an integrated basin, on the same cabinet.", prompt: `A white glossy ceramic vanity top with an integrated basin and a ${finish(/fitting|brass|tap/, "brushed brass")} mixer, on the same wall-hung wood vanity cabinet below; the mirror above unchanged. ${STYLE}`, box: (d) => { const b = boxOf(d, vanity.ref); return b ? [b[0], b[1], b[2], b[1] + (b[3] - b[1]) * 0.45] : null; } },
      { key: "shattaf_off_door_wall", request: "Remove the hand spray (shattaf), its hose and its wall valve from the wall beside the door.", prompt: `Plain wall tiles continuing the wall around them — ${finish(/wall/, "warm beige large-format stone-look tiles")}; nothing on this part of the wall: no hand spray, no hose, no valve. ${STYLE}`, box: () => [78, 52, 88, 68] },
    ];
    const log: Record<string, unknown>[] = [];
    let edits = 0, kept = 0, cabinetKept = false;
    for (const c of comments) {
      const base = c.box(parentRead);
      if (!base) { log.push({ comment: c.key, error: "its region was not found in the parent" }); continue; }
      const box = padBox(base, 1.5);
      let done = false;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        edits++;
        const size = imageSize(parent)!;
        const out = await fill(parent, await maskPng(size, [box]), c.prompt, `${c.key}#${attempt}`);
        fs.writeFileSync(path.join(OUT, `replay-${c.key}-a${attempt}.jpg`), out);
        const after = await read(out, "after", { bytes: parent, located: parentRead.items });
        const resizable = new Set([...itemsNamedBy(c.request, items), ...current.resizable]);
        // Judged on its own: while the cabinet comment is open, the replacement and the
        // bidet it removes are left out — a later comment is not failed for an earlier one.
        const judged = cabinetKept || c.key === "cabinet" ? items : items.filter((it) => it.ref !== cab.ref && !it.gone);
        const verdict = judgePhotoPlacement(judged, parentRead, after, { resizable });
        const d = await describe(parent, out, c.request);
        const passed = verdict.passed && d.request_done !== "no";
        log.push({ comment: c.key, attempt, box, passed, layout: verdict.passed, failures: verdict.failures.map((f) => f.message), request_done: d.request_done, changed: d.changed, summary: d.summary });
        console.log(`(b) ${c.key} #${attempt}: ${passed ? "KEPT" : "not kept"} — layout ${verdict.passed ? "✓" : verdict.line} · request done: ${d.request_done} · changed: ${d.changed.join(", ")}`);
        if (passed) { kept++; done = true; parent = out; parentRead = after; if (c.key === "cabinet") cabinetKept = true; }
      }
    }
    fs.writeFileSync(path.join(OUT, "replay-final.jpg"), parent);
    results.replay = { edits, kept, one_shot: log.filter((l) => l.passed && l.attempt === 1).length, comments: comments.length, log, b6: { edits: 16, kept: 10, note: "the same four comments from v4 (247a88f0) to v13, B6, 19 Oct; 18 / 10 counting the oak edit before them" } };
    save();
    console.log(`(b) masked edits: ${edits} edits, ${kept} kept, for ${comments.length} comments (B6: 16 edits, 10 kept)`);
  }

  // --- (a) P1 and P3 as masked restyles -----------------------------------------------------
  if (process.argv.includes("--masked")) {
    for (const n of [1, 3]) {
      const key = `masked:P${n}`;
      if (results[key]) continue;
      const v = views.find((x) => x.n === n)!;
      const photo = await bytesOf(v.url);
      const before = readings[`photo:P${n}:current`]!.detection;
      const present = items.filter((it) => !it.gone && boxOf(before, it.ref));
      const size = imageSize(photo)!;
      // 1. The shell: every door, window and fixture masked OUT — walls, floor and ceiling restyled around them.
      let image = await fill(photo, await maskPng(size, present.map((it) => padBox(boxOf(before, it.ref)!, 1)), true), `A renovated bathroom: walls ${finish(/wall/, "warm beige large-format stone-look tiles")}; floor ${finish(/floor/, "warm beige large-format porcelain")}; ceiling ${finish(/ceiling|light/, "smooth white with a warm cove light")}. Clean, no clutter, no towels or mats. ${STYLE}`, `P${n}-shell`);
      // 2. Each fixture inside its own box (a replacement raised to its height).
      for (const it of present.filter((x) => !["door", "window"].includes(x.kind))) {
        const b = boxOf(before, it.ref)!;
        const what =
          it.kind === "vanity" ? `a wall-hung vanity: ${finish(/vanity/, "warm oak, two drawers")}, with its basin and a ${finish(/fitting|brass|tap/, "brushed brass")} mixer — exactly this size`
          : it.kind === "wc" ? `a floor-standing white WC: ${finish(/wc|toilet/, "rimless close-coupled, white")} — exactly this size`
          : it.kind === "shower" ? "one fixed frameless clear glass shower panel with a slim brushed-brass profile; no hinged door"
          : it.kind === "cabinet" ? "a white floor-standing storage cabinet about 1.2 m tall, plain flat doors; no bidet"
          : `the ${it.short}, renovated`;
        image = await fill(image, await maskPng(size, [padBox(it.kind === "cabinet" ? raiseBox(b, 3) : b, 1)]), `${what[0]!.toUpperCase()}${what.slice(1)}. ${STYLE}`, `P${n}-${it.short}`);
      }
      fs.writeFileSync(path.join(OUT, `masked-P${n}.jpg`), image);
      const after = await read(image, "after", { bytes: photo, located: before.items });
      const verdict = judgePhotoPlacement(items, before, after, { resizable: current.resizable });
      const kinds = new Set(present.map((x) => x.kind));
      const f = verdict.passed && anchor ? await follows(image, kinds) : null;
      const van = itemOf("vanity");
      results[key] = { layout: verdict.passed, failures: verdict.failures.map((x) => x.message), vanity_area_ratio: ratio(boxOf(before, van.ref), boxOf(after, van.ref)), vanity_in_photo: !!boxOf(before, van.ref), vanity_added: !boxOf(before, van.ref) && !!boxOf(after, van.ref), follows: f ? { score: f.score, passed: f.passed } : null, fills: 1 + present.filter((x) => !["door", "window"].includes(x.kind)).length };
      save();
      console.log(`(a) masked P${n}: layout ${verdict.passed ? "✓" : verdict.line} · vanity ×${(results[key] as { vanity_area_ratio: number | null }).vanity_area_ratio ?? "— (not in the photo)"} · follows ${f ? f.score : "—"}`);
    }
  }

  // --- (a) the control: today's pipeline, the vanity's size in the prompt ---------------------
  if (process.argv.includes("--control")) {
    for (const n of [1, 3]) {
      const key = `control:P${n}`;
      if (results[key]) continue;
      const v = views.find((x) => x.n === n)!;
      const photo = await bytesOf(v.url);
      const before = readings[`photo:P${n}:current`]!.detection;
      const van = itemOf("vanity");
      const vb = boxOf(before, van.ref);
      const sizeLine = vb ? `The vanity is a compact unit, 870 mm wide and 540 mm deep. In this photo it spans ${Math.round(vb[2] - vb[0])}% of the frame's width and ${Math.round(vb[3] - vb[1])}% of its height — draw it exactly that size: not longer, not deeper, not taller.` : "There is no vanity in this photo — do not add one.";
      const wcInView = !!boxOf(before, itemOf("wc").ref);
      const res = await cap.run(`a control restyle P${n} (two attempts)`, 2 * (WORST_CASE_USD["google/nano-banana-pro"] + WORST_CASE_USD.reading + WORST_CASE_USD.check), async () => {
        const r = await restyleWithCheck({ project_id: P, arm: "edit_pro", photoUrl: v.url, photoBytes: photo, items, before, style: anchor!.style, extraImages: [anchor!.image_url], maxAttempts: 2, anchor: { label: anchor!.label, bytes: anchor!.bytes }, notes: [...fittingNotes(v.camera, current.plan, wcInView), ...current.notes, sizeLine], resizable: current.resizable });
        return { value: r, spend: r.spend.map((s) => ({ ...s, purpose: "eval" as const, detail: { ...(s.detail ?? {}), step: "b10_control" } })) };
      });
      if (res.final) fs.writeFileSync(path.join(OUT, `control-P${n}.jpg`), res.final.bytes);
      const last = res.attempts.at(-1)!;
      results[key] = { layout: res.outcome === "passed", line: res.line, attempts: res.attempts.length, vanity_area_ratio: ratio(vb, last.after ? boxOf(last.after, van.ref) : null), failures: res.attempts.map((a) => a.verdict?.failures.map((f) => f.message) ?? [a.error]) };
      save();
      console.log(`(a) control P${n}: ${res.line} · attempts ${res.attempts.length} · vanity ×${(results[key] as { vanity_area_ratio: number | null }).vanity_area_ratio ?? "—"}`);
    }
  }
} catch (e) {
  if (e instanceof SpendCapReached) {
    results.stopped_at_cap = e.message;
    save();
    console.log(`STOPPED AT THE CAP: ${e.message}`);
  } else throw e;
}
console.log(`session spend: US$${(await cap.spent()).toFixed(2)} of US$${cap.capUsd.toFixed(2)}`);
