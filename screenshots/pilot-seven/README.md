# Pilot Seven — screenshot capture manifest

**Status: NOT CAPTURED IN THE VERIFICATION ENVIRONMENT.**

The verification agent runs against a headless in-app browser pane that **cannot
composite frames** (screenshot returns _"the Browser pane is not displayed, so
the page is not compositing frames"_), and the 3D views additionally need WebGL,
which the pane does not provide. Per the verification brief, composed or
data-assembled images do **not** count as evidence, so nothing here was
auto-generated. **Abdallah captures these manually** — real browser at
**1440×900**, light mode, dev server on `http://localhost:3091` with all six
pilot flags `true`.

Project = Mudon pilot villa `6b5fda9d-e40f-4e16-940c-7a17d27ec5dc`.
Living room = "Family Area" `65e8f9eb-ca61-4de6-971f-4171a94c8758`.

Save each as the filename in the first column.

| File | Route / state | How to reach the exact state |
| --- | --- | --- |
| `01-drawings-card.png` | `/project/<id>/plan` | Scroll to the "Drawings" card (needs `DRAWINGS_ENABLED`). Capture the card. |
| `02a-sheet-asbuilt-plan.png` | `/project/<id>/drawings` | Drawing set, sheet 1 — as-built dimensioned plan (1:100, title block, north arrow, dimension chains). |
| `02b-sheet-demolition.png` | `/project/<id>/drawings` | Sheet 2 — proposed / demolition plan. (Mudon proposed == as-built → no demolition marks; that is expected.) |
| `02c-sheet-finish-schedule.png` | `/project/<id>/drawings` | Sheet 3 — finish schedule table (Room / Surface / Material / Area m²). |
| `02d-sheet-electrical.png` | `/project/<id>/drawings` | Electrical services sheet (symbols + legend + count table). Present because Mudon has seeded fixtures. |
| `02e-sheet-plumbing.png` | `/project/<id>/drawings` | Plumbing services sheet. |
| `03-viewer-orbit.png` | `/project/<id>/viewer` | **WebGL.** Orbit mode — full villa shell from above/oblique. |
| `04-viewer-walk.png` | `/project/<id>/viewer` | **WebGL.** Click "Walk", pointer-lock, WASD to eye-level 1.6 m interior. |
| `05-inspect-wall-3d.png` | `/project/<id>/viewer` | Tap a wall → the InspectPanel opens with the element→BoQ mapping. |
| `06-2d-read-inspect.png` | `/project/<id>/drawings` (read-mode plan) **or** `/project/<id>/plan` in read mode | **P4b.** Tap a wall/room on the read-only 2D plan → InspectPanel open. Must be a real capture — the interim `2d-inspect` mock does not count. |
| `07-whatif-two-toggles.png` | `/project/<id>/boq` | What-if panel open; change **two** material grades (e.g. Floor Finishes → premium, Wall painting → economy). Capture the moved Project total + both changed rows (brass dots). |
| `08-permit-card-fired.png` | `/project/<id>/boq` | PERMITS & APPROVALS card. To show it FIRED (not the calm state), a proposed snapshot with a wall removed must exist (see status report §permits); otherwise it shows "needs no permit as designed". |
| `09-staged-render.png` | `/project/<id>/render` | Family Area render generated with `STAGING_ENABLED=true` — visibly furnished, architecture unchanged. (Needs a live Replicate render.) |

## Notes for the capturer
- `03` and `04` require a WebGL-capable browser — any normal Chrome/Edge is fine.
- `08` fired state + `09` staged render both need a bit of setup (a proposed
  snapshot with a wall removed; a live staged render). The status report's
  "Permits" and "Staging" sections give the exact steps.
- `06` (P4b 2D read-mode inspect) is explicitly called out in the brief: capture
  the **real** 2D read-mode panel, not the interim composed mock.
