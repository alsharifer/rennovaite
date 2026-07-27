# Render Upgrade Playbook — step-by-step with Claude Code

Companion to `docs/RENDER_UPGRADE_PLAN.md` (the technical plan). This document tells you
**what YOU do** and **exactly what to paste into Claude Code**, phase by phase.

---

## How to work through this

1. **One Claude Code session per phase.** Start each phase with a fresh session (`claude`
   in `C:\dev\rennovaite`, or `/clear` if continuing) so context stays sharp.
2. **Always start in Plan Mode** (press `Shift+Tab` twice before sending the prompt, or
   ask "make a plan first"). Review the plan, then approve execution. This catches
   misunderstandings before code is written.
3. **Commit between phases.** After you verify a phase, run:
   `git add -A && git commit -m "render upgrade: phase N"`. If a phase goes sideways,
   `git checkout .` and restart the session with a sharper prompt.
4. **Keep the dev server running** in a second terminal (`npm run dev`) so you can
   verify in the browser immediately.

---

## Prerequisites (once, before Phase 0) — you, ~15 minutes

- [ ] **Replicate billing**: log into replicate.com → Account → Billing. Confirm the
      card is active and set a **spend limit** (USD 25/month is plenty for this work).
- [ ] **Confirm model access**: open these pages while logged in and run each once in
      the playground with any photo — this verifies your token can call them:
      - replicate.com/google/nano-banana
      - replicate.com/black-forest-labs/flux-kontext-pro
      - replicate.com/qwen/qwen-image-edit
- [ ] **Branch**: in the repo run `git checkout -b render-upgrade`.
- [ ] **Have the before photos handy**: `assets/living-before.jpg`,
      `assets/master-bed-before.jpg`, `assets/bedroom-2-before.jpg`. Phase 1 wires them in.
- [ ] Confirm `.env.local` has a working `REPLICATE_API_TOKEN`.

---

## Phase 0 — stop the bleeding (you: 10 min, Claude Code: ~20 min)

### Your steps
1. Open a Claude Code session in the repo.
2. Paste the prompt below.
3. After it finishes: render one room in the app and confirm no white grid/box lines.
4. Commit.

### Prompt to paste into Claude Code

```
Read docs/RENDER_UPGRADE_PLAN.md, Phase 0 only. Execute exactly that scope — this is a
quick artifact fix, not the full pipeline rebuild:

1. In app/api/render/route.ts: change the default render mode from "canny" to "depth"
   and lower GUIDANCE from 25 to 10. Update the stale comments to explain why (canny
   reproduces our synthetic wireframe as white grid lines in the output; depth gradients
   cannot leave line artifacts).
2. In lib/control-image.ts: remove the window-parallelogram drawing from
   buildControlImageBase64 (it is the most recognisable artifact), leaving the rest of
   the canny variant intact since render-iterate still references it.
3. Check app/api/render-iterate/route.ts for the same GUIDANCE constant and lower it to
   10 there too.

Do NOT touch prompts, models, or the database. Run tsc --noEmit to verify, and summarise
the diff when done.
```

### Verify before moving on
- [ ] Render any room → no white rectangles/grid/box lines.
- [ ] Renders still complete in ~10–30s.
- [ ] `git commit -m "render upgrade: phase 0 artifact fix"`

---

## Phase 1 — photo-first pipeline (you: ~1 hr spread out, Claude Code: half a day)

This is the big one. Split it into **three Claude Code prompts** (1A schema+upload,
1B render path, 1C eval harness) so each change is reviewable.

### Your steps
1. Run prompt 1A. When it finishes, apply the migration it produced against Supabase
   (it will tell you the command — typically paste the SQL into the Supabase dashboard
   SQL editor, same as migrations 001–009).
2. In the app, upload the three `/assets` before photos to the matching demo rooms.
3. Run prompt 1B. Then render the living room in Contemporary Majlis and sanity-check:
   is it recognisably YOUR room?
4. Run prompt 1C. Open the contact sheet it generates (`docs/render-eval/index.html`)
   in a browser and **judge the winner yourself** — pick the model that best preserves
   room geometry and produces the most premium look. Set it in `.env.local` as
   `RENDER_MODEL=<winner>` .
5. Test the tweak loop: render → "make the sofa green" → confirm ONLY the sofa changes.
6. Commit after each sub-step.

### Prompt 1A — schema + photo upload

```
Read docs/RENDER_UPGRADE_PLAN.md (Phase 1, steps 1–2 and 5). Implement the room-photo
foundation:

1. New migration scripts/migrations/010_room_photos.sql: create table room_photos
   (id uuid pk default gen_random_uuid(), room_id uuid references rooms(id),
   storage_path text, public_url text, created_at timestamptz default now());
   and add columns to renders: source_image_url text, model text, mode text.
   Follow the style of migrations 001–009.
2. New API route app/api/room-photo/route.ts: POST multipart with room_id + file
   (jpg/png, max 20MB), uploads to the existing storage bucket under
   <project_id>/rooms/<room_id>/<uuid>.<ext>, inserts a room_photos row, returns the
   public URL. Mirror the patterns in app/api/upload/route.ts including zod validation.
3. Update lib/database.types.ts for the new table/columns.
4. UI: in the AI Designer room view, add a photo-upload affordance on the room card —
   an "Add room photo" action if none, else the photo thumbnail wrapped in the
   matte-image utility per CLAUDE.md Atelier rules (Material Symbols icon, no lucide).
   Show upload progress and errors inline.
5. Give me the exact steps to apply the migration.

Validate with tsc --noEmit and the linter. Don't touch the render routes yet — that's
the next task.
```

### Prompt 1B — the new render path

```
Read docs/RENDER_UPGRADE_PLAN.md (Phase 1, steps 3–4). Rebuild the render pipeline to be
photo-first:

1. app/api/render/route.ts:
   - Load the room's latest room_photos row. If one exists, call the image-edit model
     instead of flux-canny-pro: model from env RENDER_MODEL defaulting to
     "google/nano-banana", with the room photo URL as the image input and this prompt
     template: "Renovate this exact room in <style name> style: <style description,
     materials and palette from lib/styles.ts, plus KG context when present>. Keep the
     room's architecture, wall positions, window and door locations, and camera angle
     exactly the same. Photorealistic interior photography, magazine quality."
     Check the model's exact input schema on Replicate (image_input array vs
     input_image string) and handle both nano-banana and flux-kontext-pro shapes so
     RENDER_MODEL can switch between them.
   - If NO photo exists, keep the current depth-control path as the temporary fallback.
   - Record source_image_url, model, and mode on the renders insert.
2. app/api/render-iterate/route.ts: keep the Claude prompt-rewrite step, but change the
   generation call: pass the PARENT RENDER's image_url as the edit-model input with the
   rewritten tweak as the instruction, so tweaks are localized edits instead of full
   re-rolls. Record parentage as today.
3. Keep the existing cache check, timeout handling, and error shapes. Update
   CLAUDE.md's stack section to mention the new render path in one paragraph.

Validate with tsc --noEmit. Then tell me exactly how to test end-to-end in the browser.
```

### Prompt 1C — eval harness

```
Read docs/RENDER_UPGRADE_PLAN.md (Phase 1, step 6). Build scripts/render-eval.ts,
runnable with: npx tsx scripts/render-eval.ts

- Inputs: the three before photos in /assets (living-before.jpg, master-bed-before.jpg,
  bedroom-2-before.jpg) × styles [contemporary-majlis, luxe-minimal, scandi-arabic] ×
  models [google/nano-banana, black-forest-labs/flux-kontext-pro, qwen/qwen-image-edit].
- Reuse the exact prompt template from app/api/render/route.ts (extract it into a
  shared lib/render-prompts.ts helper if needed so route and script cannot drift).
- Call Replicate directly with REPLICATE_API_TOKEN from .env.local, 3 concurrent max,
  save outputs to docs/render-eval/<model>/<photo>-<style>.jpg, and generate
  docs/render-eval/index.html — a contact-sheet grid (original photo in column 1,
  one column per model) so I can judge side by side.
- Print a cost estimate before running and ask for confirmation (27 images ≈ $1.1).
- Add docs/render-eval/ to .gitignore.
```

### Verify before moving on
- [ ] Living-room render is recognisably the real room (same window, same layout).
- [ ] Contact sheet reviewed; `RENDER_MODEL` set to your winner in `.env.local`.
- [ ] Tweak changes only the requested element.
- [ ] `renders` rows carry source_image_url + model.
- [ ] Commit: `git commit -m "render upgrade: phase 1 photo-first pipeline"`

---

## Phase 2 — off-plan fallback + material grounding (you: 20 min, Claude Code: ~half a day)

### Your steps
1. Paste the prompt. Review the plan it proposes, then approve.
2. Test: create a room WITHOUT a photo → render → confirm a clean result (no wireframe).
3. Test: select vendor SKUs for a room, re-render, confirm the materials show up.
4. Commit.

### Prompt to paste into Claude Code

```
Read docs/RENDER_UPGRADE_PLAN.md, Phase 2. Implement both steps:

1. Off-plan path: in app/api/render/route.ts, when a room has NO photo, replace the
   depth-control fallback with a two-step generation:
   a) Base: call black-forest-labs/flux-1.1-pro (text-to-image, no control image) with
      a prompt built from the parsed plan: room type, real width × depth from the
      polygon + area (reuse the geometry helpers in lib/control-image.ts), ceiling
      2.9m, single window placement, "empty unfurnished room, screed floor, white
      primed walls, photorealistic, eye-level 24mm".
   b) Style pass: feed that base image through the SAME image-edit call as the photo
      path. Record mode="offplan" on the render row.
2. Material grounding: when the project has vendor selections (vendor_selections /
   lib/vendor-options-helpers.ts) or a chosen style moodboard image under
   assets/moodboards, include the moodboard as a second image input to nano-banana and
   append a "Materials:" clause to the prompt listing the selected SKU descriptions.
3. Delete lib/control-image.ts and all remaining references (render-iterate, debug
   route app/api/debug/control-image). Remove flux-canny-pro / flux-depth-pro
   constants. Update CLAUDE.md accordingly.

Validate with tsc --noEmit, then give me a browser test checklist covering: room with
photo, room without photo, room with SKU selections.
```

### Verify before moving on
- [ ] No-photo room renders clean; `lib/control-image.ts` is gone.
- [ ] SKU-grounded render visibly uses the selected material family.
- [ ] Commit: `git commit -m "render upgrade: phase 2 offplan + SKU grounding"`

---

## Phase 3 — finish quality + guardrails (you: 15 min, Claude Code: ~half a day)

### Your steps
1. Paste the prompt, review plan, approve.
2. Approve a design in the app → check the upscaled export appears.
3. Deliberately break a render (e.g., tweak "add a floating cube") → confirm the QA
   gate catches/retries it and logs the event.
4. Commit, then merge: `git checkout main && git merge render-upgrade`.

### Prompt to paste into Claude Code

```
Read docs/RENDER_UPGRADE_PLAN.md, Phase 3. Implement:

1. Upscale on approval: in app/api/approve-design/route.ts, after approval run the
   approved render through an upscaler on Replicate (philz1337x/clarity-upscaler at 2×;
   verify its current input schema first), store the result URL in a new
   approved_designs.upscaled_url column (migration 011), and surface it in the UI where
   the approved render is shown/downloaded.
2. QA gate: after every render in app/api/render/route.ts, make one Anthropic vision
   call (claude-sonnet-4-6, the pattern from app/api/generate-boq) with the source
   photo + render asking for JSON: {structure_preserved: bool, artifacts: bool,
   photorealistic: bool, reason: string}. zod-validate it. On failure, retry the render
   ONCE with the reason appended to the prompt as a correction; if it fails again,
   return the render but include qa: failed in the response and log to feedback_events.
3. Async: convert the Replicate calls in render + render-iterate to
   replicate.predictions.create + client-side polling via a new GET
   app/api/render/status?prediction_id= route, so the UI shows progress instead of one
   90-second wait. Keep a server-side cap of 3 in-flight renders per project.
4. Analytics: PostHog events render_started, render_completed, render_qa_failed,
   render_tweaked with model + mode props, via lib/analytics.ts patterns.

Validate with tsc --noEmit and give me the browser test checklist.
```

### Verify before moving on
- [ ] Approval produces a visibly sharper export.
- [ ] QA gate fires and logs; bad render auto-retries once.
- [ ] Render UI shows progress; no 90s frozen wait.
- [ ] Merge to main.

---

## Budget & timeline summary

| Phase | Your time | Claude Code time | Replicate spend |
|---|---|---|---|
| Prereqs | 15 min | — | ~$0.20 (playground tests) |
| 0 | 10 min | ~20 min | ~$0.10 |
| 1 | ~1 hr | ~half a day | ~$2–3 (incl. 27-image eval) |
| 2 | 20 min | ~half a day | ~$1 |
| 3 | 15 min | ~half a day | ~$0.50 |
| **Total** | **~2 hrs** | **~2 days** | **< $5** |

## If something goes wrong

- **Claude Code drifts from the plan** → stop it, `git checkout .`, restart the session,
  re-paste the prompt with the extra constraint spelled out.
- **A model rejects the input shape** → paste the Replicate error back into Claude Code
  verbatim; input schemas are the most common friction point and it will fix them fast.
- **Renders look worse than the eval** → check RENDER_MODEL in .env.local matches your
  contact-sheet winner, and that the room actually has a photo attached.
- **Costs spike** → the Replicate spend limit from Prereqs is the backstop; renders are
  also cached on (source image, prompt, model), so repeats are free.
