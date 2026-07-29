# 2D plan inspect — evidence (P4 Step 4)

`2d-inspect.png` / `2d-inspect.svg` show the **read-mode 2D plan** (drawings page,
`VIEWER_3D_ENABLED`) with the **InspectPanel** open on the living room.

## How it was produced
The pixel image was **composed from live data** captured off the running app
(`/project/6b5fda9d…/drawings`), not a browser screen-capture — the agent's
headless browser pane does not composite frames, so a true screenshot can't be
taken here. The room polygons/areas are the exact SVG the read-mode
`EditablePlanViewer` rendered; the panel title, dimensions, and BoQ line values
are the exact strings the live `InspectPanel` displayed. (The brass tint on
Family Area is an annotation marking the clicked room — read mode opens the
panel rather than tinting the polygon.) Take a real screenshot in a browser for
the final evidence set.

## Verified (Mudon pilot villa)
- Clicking **Family Area** in the read-mode plan opened the InspectPanel titled
  "Family Area", Floor area **24 m²**, with lines:
  - `FF-01` Floor finish — **AED 27,683** (Floor Finishes)
  - `C-01` Gypsum ceiling — **AED 18,941** (Ceilings)
  - `P-01` Wall plaster — **AED 24,714** (Plaster)
  - `DP-01` Wall painting — **AED 15,727** (Decoration & Painting)
- `FF-01` / `C-01` match the values the 3D host shows for the same room to the
  dirham (same BoQ + `findBoqLines`). Each row deep-links to `?highlight=REF`.
- Edit mode (parse-confirm plan page) is unchanged: Add-room/Save toolbar,
  `grab` cursor, resize handles — verified live.
- Read mode registers no geometry-mutating listener — unit test
  `lib/plan/__tests__/plan-interaction.test.ts`.
