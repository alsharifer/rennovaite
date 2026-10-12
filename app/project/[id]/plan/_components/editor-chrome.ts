// =============================================================================
// The plan editor's Blueprint chrome (K8): one set of classes for the toolbars,
// palettes, inspectors and fields of every layer (plan, openings, elements,
// landscape, electrical, plumbing), and the semantic colours the canvases draw
// with. Zero radius, hairlines, no shadows; brass only as a line (the chosen
// tool's underline, a selection, the focus ring); no status hues — a state is
// a word (TAG), a dash, or the inverse block.
//
// SVG colours are CSS variables from tokens.css, so the canvas follows the
// theme; every page that hosts the editor (02 Scope, 06 Documents) is a
// Blueprint root.
// =============================================================================

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bp-focus-ring";

/** A toolbar button (Add room, Fix overlaps, Undo, Delete selected). */
export const TOOL_BTN = `inline-flex h-9 items-center gap-1.5 rounded-none border border-bp-line-control px-3 t-label-md text-bp-ink-primary hover:bg-bp-surface-sunken ${FOCUS} disabled:cursor-not-allowed disabled:text-bp-ink-tertiary disabled:border-bp-line-hairline disabled:hover:bg-transparent`;

/** A small secondary action inside an inspector bar (Apply, + Vertex, Set size). */
export const SMALL_BTN = `inline-flex h-8 items-center gap-1 rounded-none border border-bp-line-control px-2.5 t-label-md text-bp-ink-primary hover:bg-bp-surface-sunken ${FOCUS} disabled:cursor-not-allowed disabled:text-bp-ink-tertiary disabled:border-bp-line-hairline`;

/** A palette / toggle chip. Pair with chipState(active). */
export const CHIP_BTN = `inline-flex h-8 items-center gap-1.5 rounded-none border border-b-2 px-2.5 t-label-md transition-colors ${FOCUS} disabled:cursor-not-allowed disabled:text-bp-ink-tertiary`;
export function chipState(active: boolean): string {
  return active
    ? "border-bp-line-control border-b-bp-brass bg-bp-surface-sunken text-bp-ink-primary"
    : "border-bp-line-hairline border-b-bp-line-hairline bg-bp-surface-base text-bp-ink-secondary hover:bg-bp-surface-sunken hover:text-bp-ink-primary";
}

/** Text / select field. */
export const FIELD = `h-8 rounded-none border border-bp-line-control bg-bp-surface-base px-2 t-body-sm text-bp-ink-primary placeholder:text-bp-ink-tertiary ${FOCUS} disabled:text-bp-ink-tertiary`;

/** Numeric field (mm / m) — mono, tabular, right-aligned. */
export const NUM_FIELD_BASE = `h-8 rounded-none border border-bp-line-control bg-bp-surface-base px-1.5 text-right t-num-sm text-bp-ink-primary ${FOCUS} disabled:text-bp-ink-tertiary`;
export const NUM_FIELD = `${NUM_FIELD_BASE} w-[76px]`;

/** The selected item's bar (zone geometry, fixture size, run cross-section). */
export const INSPECTOR_BAR = "flex flex-wrap items-center gap-x-4 gap-y-2 border border-bp-line-hairline bg-bp-surface-raised px-3 py-2 t-body-sm text-bp-ink-secondary";

/** A state said in words ("Size assumed", "Derived outline", "approx."). */
export const TAG = "inline-flex items-center border border-bp-line-strong px-1.5 t-label-caps text-bp-ink-secondary";

/** The small caps label before a palette ("ADD"). */
export const LABEL = "t-label-caps text-bp-ink-tertiary";

/** The canvas frame. */
export const CANVAS_FRAME = "overflow-hidden border border-bp-line-hairline bg-bp-surface-raised";

/** The line under the canvas (how to use it, live counts). */
export const CAPTION = "t-body-sm text-bp-ink-secondary";

// ---- SVG colours (semantic tokens; theme-aware) ------------------------------
export const SVG = {
  ink: "var(--color-ink-primary)",
  inkSecondary: "var(--color-ink-secondary)",
  inkTertiary: "var(--color-ink-tertiary)",
  /** A room / zone fill, drawn at partial opacity on the raised canvas. */
  roomFill: "var(--color-line-hairline)",
  /** An open (unroofed) zone — ground, lighter than a floor; the dashed edge says open. */
  openFill: "var(--color-surface-sunken)",
  /** Hover on a room. */
  hoverFill: "var(--color-line-strong)",
  /** Existing context: a building's mass, a wall's footprint. */
  contextBuilding: "var(--color-line-strong)",
  contextWall: "var(--color-ink-tertiary)",
  /** Brass — selection and the existing-item outline (lines only). */
  brass: "var(--color-active-brass)",
  /** Marker / handle fill. */
  surface: "var(--color-surface-base)",
  sans: "var(--font-sans), sans-serif",
  mono: "var(--font-mono), monospace",
} as const;
