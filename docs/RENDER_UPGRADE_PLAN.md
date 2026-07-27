# Render Quality Upgrade Plan

Status: proposed · Owner: rendering pipeline · Written for execution with Claude Code, phase by phase.

## 1. Diagnosis — why our renders lose to RoomGPT / Interior AI / Remodel AI

**The white grid squares in "Family Area — Concept v1" are our own control image.**
`lib/control-image.ts` draws a synthetic one-point-perspective wireframe (back-wall
rectangle + 4 perspective lines + a window parallelogram) and feeds it to
`black-forest-labs/flux-canny-pro` with `guidance: 25`. A canny ControlNet treats every
line in the control image as an edge that must exist in the output — so the model
faithfully paints our guide box into the scene as white frames/grout lines. Lowering
guidance (30 → 25, per the comment in `app/api/render/route.ts`) reduced "literal
hexagons" but cannot fix it: the control image contains almost no real structure, so the
model either ignores it (no benefit) or draws it (artifacts).

**The deeper problem: we are text-to-image; competitors are photo-to-photo.**
RoomGPT, Interior AI, Remodel AI, GenRoom all start from a photo of the actual room and
restyle it, preserving real geometry, windows, and camera angle. That is why their output
reads as "my room, renovated" while ours reads as "a generic AI room". We have the before
photos (assets/living-before.jpg, master-bed-before.jpg, bedroom-2-before.jpg) and an
upload pipeline — but photos never enter the render path. The floorplan polygon is a
weaker structural signal than a single photo.

Secondary issues found in review:
- `render-iterate` re-rolls the whole image from a rewritten prompt — tweaks change
  everything, not just the requested detail.
- No upscale/post-process pass; JPG at quality 85 directly from the model.
- Guidance 25 is far outside Flux's sweet spot and forces over-literal control adherence.
- The 90s serial Replicate call has no queue/streaming; failures burn the whole wait.

## 2. Target architecture

```
                    ┌─ has room photo? ──────────────────────────────┐
                    │ YES (primary path — competitor parity+)         │
 room + style ──────┤   photo + moodboard + style prompt              │
                    │   → IMAGE-EDIT MODEL (structure-preserving)     │
                    │ NO (off-plan / unbuilt)                         │
                    │   staged base: text-to-image "empty room shell" │
                    │   → same IMAGE-EDIT MODEL for style pass        │
                    └─────────────────────────────────────────────────┘
 tweak loop:  previous render + instruction → IMAGE-EDIT MODEL (localized edit)
 finish:      upscale pass → store → (optional) Claude-vision QA gate
```

### Model selection (Replicate, verified July 2026)

| Role | Model | Price/img | Notes |
|---|---|---|---|
| Primary edit/restyle | `google/nano-banana` | ~$0.039 | Best scene consistency + lighting preservation; accepts multiple input images (photo + moodboard style ref) |
| Premium tier ("final render") | `google/nano-banana-pro` | ~$0.15 | Gemini-3-Pro-based, studio-grade control; use for approved-design final export |
| Fast/cheap fallback + A/B | `black-forest-labs/flux-kontext-pro` | $0.04 | 4.4s, realistic texture; weaker at object removal |
| Budget A/B | `qwen/qwen-image-edit` | $0.03 | Strong geometry preservation in tests |
| Off-plan base image | `black-forest-labs/flux-1.1-pro` (or `bytedance/seedream-4`) | ~$0.04 | Clean empty-room shell from dimensions prompt; no control image at all |
| Upscale/finish | `philz1337x/clarity-upscaler` or `recraft-ai/recraft-crisp-upscale` | ~$0.02 | 2× pass on approved renders |

Kill `flux-canny-pro` + the synthetic wireframe entirely. Keep `flux-depth-pro` only if
the off-plan path proves to need a depth hint (it likely won't).

## 3. Phases (each is a self-contained Claude Code session)

### Phase 0 — stop the bleeding (≤ 1 hour)
1. `app/api/render/route.ts`: flip default `mode` to `depth` (gradient control can't
   leave line artifacts) and drop `GUIDANCE` to 10.
2. `lib/control-image.ts`: delete the window parallelogram from the canny variant (the
   most recognisable artifact in the attached screenshot).
3. Ship. This buys time; it does not reach competitor quality.

### Phase 1 — photo-first pipeline (the real fix, ~1–2 days)
1. **Schema**: migration `010_room_photos.sql` — `room_photos` table (`id`, `room_id`,
   `storage_path`, `public_url`, `created_at`), plus `renders.source_image_url`,
   `renders.model`, `renders.mode` columns.
2. **Upload**: extend `app/api/upload` (or new `app/api/room-photo`) to accept a photo
   per room into the existing bucket; wire a photo-upload affordance into the room card
   in the AI Designer (matte-image frame per Atelier rules).
3. **Render route**: in `app/api/render/route.ts`, when the room has a photo:
   - input: `image_input: [roomPhotoUrl, moodboardUrl?]`, prompt template:
     *"Renovate this exact room in <style> style: <style palette/materials from
     lib/styles.ts + KG context>. Keep the room's architecture, wall positions, window
     and door locations, and camera angle exactly the same. Photorealistic interior
     photography, magazine quality."*
   - model: `google/nano-banana`; env override `RENDER_MODEL` for A/B.
   - remove control-image code path from this branch.
4. **Iterate route**: `app/api/render-iterate/route.ts` — pass the parent render's
   image as the edit input with the (Claude-rewritten) tweak as the instruction. Keep
   the prompt-rewrite step; it's good. Delete the control-image + re-roll logic.
5. **Seed demo data**: attach the three `/assets` before photos to the canonical demo
   rooms so the pilot flow shows the photo path end-to-end.
6. **Eval harness**: `scripts/render-eval.ts` — for each before photo × 3 styles ×
   {nano-banana, flux-kontext-pro, qwen-image-edit}, generate and write an HTML contact
   sheet to `docs/render-eval/`. Judge once, pin the winner in env, keep the script for
   regressions.

Acceptance: a render of the real living room photo in Contemporary Majlis that a
homeowner recognises as *their* room; zero geometric artifacts; tweak loop changes only
the requested element.

### Phase 2 — off-plan path + material grounding (else branch, ~1 day)
1. No photo → build base with text-to-image (`flux-1.1-pro`): prompt from room type +
   real dimensions from the parsed plan ("empty unfurnished room, 5.6m × 4.3m, ceiling
   2.9m, window on the right wall, screed floor…"), then run the same style edit pass on
   that base. Two calls ≈ $0.08 — still cheaper than one flux-canny-pro today.
2. Ground materials: inject the user's selected SKUs (vendor-selections) and the style
   moodboard image into the edit call — nano-banana consumes them as style references.
   This is the differentiator competitors don't have: renders tied to purchasable SKUs
   that flow into the BoQ.
3. Delete `lib/control-image.ts` once both paths are live.

### Phase 3 — finish quality + guardrails (~1 day)
1. Upscale pass on design approval (`approve-design` route): clarity-upscaler 2×,
   store alongside original.
2. QA gate: after each render, one Claude vision call — "same room geometry? wireframe/
   grid artifacts? photorealistic?" → auto-retry once with adjusted prompt on fail;
   log result to `feedback_events` for PostHog.
3. Ops: move Replicate calls to async predictions + webhook (or client polling) to kill
   the 90s serial wait; per-project render budget counter; cache keyed on
   (source_image, prompt, model).

## 4. Cost picture

Today: flux-canny-pro ≈ $0.05/render, output unusable. Target: nano-banana restyle
$0.039 + occasional upscale $0.02 → ≈ $0.06 per *good* render; premium final export via
nano-banana-pro $0.15 only on approval. A full 6-room concept pass ≈ $0.40–0.90.

## 5. What NOT to do

- Don't fine-tune a custom model yet — the edit-model class already clears the
  competitor bar; revisit only if style fidelity to Gulf-regional aesthetics
  (Majlis proportions, mashrabiya detail) proves weak with prompt + moodboard refs.
- Don't build 3D reconstruction into this track — room sizing comes from the parsed
  plan; rendering needs a photo, not a mesh (per the earlier model-stack discussion).
- Don't keep the synthetic wireframe as a "fallback of the fallback". It is the bug.
