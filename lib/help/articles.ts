// =============================================================================
// lib/help/articles.ts — the help drawer's "About this page" articles (K8 #13,
// spec §6.8, Figma 65:1247). Pure data + a search. Each article names the
// pages ("areas" — a journey step key or a shell page title) it belongs to;
// the drawer shows the current page's, and search reaches all of them.
//
// Every sentence describes what the app does today. A promise the product
// does not keep (a reply time, a feature) does not belong here.
// =============================================================================

export interface HelpArticle {
  id: string;
  title: string;
  body: string[];
  /** Step keys (owner or firm) and shell page titles; "*" = every page. */
  areas: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "marks",
    title: "What the estimate mark means",
    areas: ["overview", "hub", "cost", "boq", "boq_review", "specification", "Projects", "*"],
    body: [
      "Every figure carries a small mark that says where it comes from. A solid mark is measured, or your firm’s own rate. Three-quarters is checked by a quantity surveyor. Half is a market reference. An open ring is estimated — worked out rather than measured. A dashed ring is still to be priced.",
      "A total takes the weakest mark of what went into it, so one estimated line makes the total an estimate. Hover or focus a figure to see its source.",
    ],
  },
  {
    id: "approx-star",
    title: "What ≈ and * mean on a total",
    areas: ["overview", "hub", "cost", "boq", "boq_review", "tender", "suppliers", "Projects"],
    body: [
      "≈ means the total is an estimate: at least one line in it is estimated, or the plan is still a draft.",
      "* means some lines are not in the total yet — they still need a price. They are named beside the total, so nothing is silently left out.",
    ],
  },
  {
    id: "no-boq",
    title: "Why a project shows “No BoQ yet”",
    areas: ["Projects", "overview", "hub"],
    body: ["The bill of quantities is generated from a confirmed plan. Until the plan has been read and checked there is nothing to measure, so there is no figure to show. Open the plan to finish it, then generate the BoQ from Cost."],
  },
  {
    id: "add-member",
    title: "Adding someone to a project",
    areas: ["Projects", "overview", "hub", "Settings"],
    body: ["During the pilot, people are added to a project by the RenovAIte team. Ask the RenovAIte team with their e-mail address and the project, and we will add them. Only members of a project can open it."],
  },
  {
    id: "overlaps",
    title: "Why two rooms overlap, and how to fix it",
    areas: ["plan", "scope", "project_plan"],
    body: [
      "When a drawing is read, two rooms can come back covering the same floor. Overlapping floor would be counted twice in the cost, so the plan check stops costing until it is fixed.",
      "Use “Fix overlaps” in the plan check, or select a pair and move a room’s edge. The check lists the pairs largest first.",
    ],
  },
  {
    id: "printed-dims",
    title: "Printed dimensions and measured shapes",
    areas: ["plan", "scope", "project_plan"],
    body: ["Where the drawing prints a room’s area or dimensions, that figure is kept — a measurement on the drawing wins over what we trace. Where it prints nothing, the area comes from the traced shape and is marked as estimated."],
  },
  {
    id: "draw-yourself",
    title: "Drawing a plan yourself",
    areas: ["plan", "scope", "project_plan"],
    body: ["With no drawing to read you can draw rooms or garden zones on a grid. The plot’s width and depth are the scale, so everything you draw comes out in real metres. Enter them once, measured on site or off the title deed."],
  },
  {
    id: "direction",
    title: "How the suggested direction is chosen",
    areas: ["design"],
    body: [
      "Your answers are scored against each direction with a fixed weighting — no AI is involved, so answering the same way always gives the same suggestion.",
      "Choosing a different direction keeps your choice; answering the questions again never overwrites it.",
    ],
  },
  {
    id: "references",
    title: "Why pin three references",
    areas: ["design"],
    body: ["Pinned references guide the style of your renders — colour, material, mood. Three give the renders enough to agree on. They never change your layout or your quantities."],
  },
  {
    id: "render-grounding",
    title: "What a render is based on",
    areas: ["renders"],
    body: ["A room render starts from your own photo of the room where you have one, otherwise from your plan’s dimensions. It is styled with your chosen direction and the products you picked, so it shows the room you are pricing."],
  },
  {
    id: "design-view",
    title: "Why a view shows “3D design view”",
    areas: ["renders", "3D view"],
    body: ["Garden renders are checked against the design: a render that moves, drops or invents a built feature does not pass. When no render passes, the 3D design view of the same camera is shown instead — it is always exactly the design."],
  },
  {
    id: "to-be-priced",
    title: "What “to be priced” means",
    areas: ["cost", "boq", "boq_review", "specification", "tender", "suppliers"],
    body: ["Some items have no reference rate yet — a pool, a deck, a special finish. They stay in the bill with no price, named beside the total, until a quantity surveyor or your contractor prices them. They are never left out silently."],
  },
  {
    id: "spec-rate",
    title: "Why choosing a product changes only the rate",
    areas: ["specification", "cost"],
    body: ["Quantities come from your plan. Picking the actual product replaces the rate the line was priced at by rule; the quantity stays the plan’s, so the change in cost is exactly the change in rate times the quantity."],
  },
  {
    id: "timeline-range",
    title: "Why the timeline is a range",
    areas: ["timeline"],
    body: ["The phases are scaled from one completed villa refit in Dubai, by the quantities in your plan. One reference project supports a range, not a date — “likely” and “could run to” for each phase. It narrows as more projects complete."],
  },
  {
    id: "tender-locked",
    title: "Why Tender is locked",
    areas: ["tender", "suppliers", "documents", "cost"],
    body: ["Contractors bid against a complete scope. While items are still to be priced, or the plan check has failed, the scope is not ready to send. The lock names what is open and links to where you fix it."],
  },
  {
    id: "scenario",
    title: "Why the live total differs from the BoQ",
    areas: ["tender", "suppliers"],
    body: ["Choosing suppliers is a scenario on your bill of quantities: your choices are saved and the live total follows them, but the stored BoQ stays as it was generated. Its total is the one every other page shows."],
  },
  {
    id: "viewer",
    title: "What the 3D view is built from",
    areas: ["3D view"],
    body: ["The model is built from your plan — the same rooms and walls the cost is measured from. It is for looking, not editing: change the plan on Plan and the model follows. Measurements marked as estimates come from defaults, such as a standard ceiling height."],
  },
  {
    id: "book-reviewed",
    title: "Why the book can’t be marked reviewed",
    areas: ["rates_basis", "Rate book"],
    body: ["Entries that need attention — a unit that looks wrong, a rate far from the reference, two figures for one item — must be settled first. Each one says what to check and offers the fix."],
  },
  {
    id: "reference-basis",
    title: "What the reference basis is",
    areas: ["rates_basis", "boq_review", "proposal", "Rate book"],
    body: ["Lines your book does not price are priced from the market reference. A client proposal can be issued on that basis only once your firm has accepted it for this revision — the fallback is a stated choice, never a silent default."],
  },
  {
    id: "no-cause",
    title: "Why a change says “no cause recorded”",
    areas: ["revisions"],
    body: ["A change between revisions is linked to its cause only when something recorded it — a correction, a rate change or a plan edit. Where nothing did, the line says so rather than guessing."],
  },
  {
    id: "proposal-locked",
    title: "Why the proposal is locked",
    areas: ["proposal", "documents"],
    body: ["A client proposal goes out only when every line is your firm’s own rate or an accepted reference basis, and your book is reviewed. The checks name what is open."],
  },
  {
    id: "rail",
    title: "Reading the journey rail",
    areas: ["*"],
    body: ["The rail shows where each step stands. A tick is done; a flag needs a look; a lock says what has to happen first. Open the step to see how to clear it."],
  },
];

/** The articles for one page: its own first, then the ones for every page. */
export function articlesFor(area: string): HelpArticle[] {
  const own = HELP_ARTICLES.filter((a) => a.areas.includes(area));
  const general = HELP_ARTICLES.filter((a) => a.areas.includes("*") && !own.includes(a));
  return [...own, ...general].slice(0, 5);
}

/** Every article whose title or body contains each word of the query. */
export function searchArticles(query: string): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return HELP_ARTICLES.filter((a) => {
    const text = `${a.title} ${a.body.join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export const HELP_TOPICS = ["A number looks wrong", "Something didn’t load", "My plan was read wrongly", "Something else"] as const;
