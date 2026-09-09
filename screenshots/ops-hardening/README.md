# Route boundaries — verification record (I10)

## On the missing PNGs

Same limitation as `screenshots/copy-pass/`: the preview pane returns screenshots
into the conversation rather than to disk, and this repo has no headless-browser
dependency. Screenshots were taken and reviewed for every case below; what is
recorded here is the **live DOM output**, which is the same thing the user sees.
Say the word and I will add `playwright` and produce real image files.

## Forced error — money path (`/project/<id>/boq`)

A route that throws was added under the BoQ segment, hit, and removed.

```
heading  : This page didn't load.
copy     : Something went wrong while building this view. Your project and its
           figures are unchanged — this failed on the way to the screen, not on
           the way to the database.
actions  : Try again · Back to your projects
reference: 670265118        (the digest — support's handle for the trace)
stack    : NONE
```

The money-path copy is deliberate. On the BoQ the first fear is "have I lost my
work", and the honest answer is no: rendering failed, nothing was written.

## Forced error — ordinary route (`/dashboard`)

```
heading  : This page didn't load.
copy     : Something went wrong while building this view. Nothing in your
           project has changed.
actions  : Try again · Back to your projects
stack    : NONE
```

Confirms the branch: `/dashboard` gets the generic line, `/boq` gets the
reassurance. Same component, different segment.

## 404 — money path (`/project/<unknown-id>/boq`)

```
title    : We couldn't find that project.
body     : It may have been removed, or the link may be pointing at a project on
           a different account.
action   : Back to your projects
leaks id : NO
stack    : NONE
```

**This is where the work actually was.** The BoQ page did not call `notFound()`
— it rendered its own bare sentence, so the shared boundary never applied. Four
other pages did the same, and two of them printed the raw project UUID at the
user:

```
Project 11111111-2222-4333-a444-555555555555 not found.
```

All five now call `notFound()`: `boq`, `page` (hub), `plan`, `render`,
`vendors`. Adding boundary files alone would have left every one of these
untouched while looking complete.

One deliberate exception: on the render route a missing **plan** is not a 404.
The project exists and the user simply has not confirmed a layout yet — that is
a step in the journey, not a broken link, so it keeps its own message.

## 404 — root (`/no-such-page`)

```
title  : We couldn't find that page.
action : Back to your projects
stack  : NONE
```

## Coverage

One shared implementation in `components/app/boundaries.tsx`; every boundary
file is three lines that render it.

- `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` — root
- `app/project/[id]/error.tsx`, `not-found.tsx` — project-scoped copy
- 15 `loading.tsx` skeletons, shaped to the page arriving: `TableSkeleton` for
  BoQ and timeline, hero-led for render/viewer/drawings/style/hub

`global-error.tsx` is deliberately plain inline styles with its own
`<html>`/`<body>`: the root layout itself has failed, so it cannot rely on
fonts, providers or the design system — those may be exactly what broke.

## Note on the icons

In the screenshots the Material Symbols glyph rasterises as its ligature text
("error", "search_off"). The font loads correctly —
`Material Symbols Outlined:loaded`, `font-family` resolved — so this is the
preview pane's rasteriser, not a defect.
