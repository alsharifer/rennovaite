// =============================================================================
// lib/render/change-request.ts — is an "Ask for a change" request structural?
// (R10a, spec §7.5). CLIENT-SAFE and pure — deterministic on purpose, so the
// same words always get the same answer.
//
// An image edit restyles a render; it cannot move walls. The walkthrough asked
// "Move the kitchen to the left side … and the windows to the right" and got
// the same picture back, then a counter dropped into a doorway. Walls, windows,
// doors, openings and the kitchen's position come from the PLAN, so a request
// to move / add / remove / resize one of them is answered with a pointer to the
// plan instead of an edit:
//
//   structural   a structural verb whose OBJECT is a structural element —
//                "move the kitchen", "add a window", "remove the wall",
//                "make the windows floor-to-ceiling", "open up the kitchen"
//   finish       anything else — "add curtains to the window" (the object is
//                the curtains), "darker floor", "warmer light"
// =============================================================================

export const STRUCTURAL_MESSAGE = "Walls and windows come from your plan — adjust them there";

// "replace the door with a walnut one", "make the window frames black", "open the curtains" are FINISH
// requests, so replace / make / plain open are not structural verbs (a resize is caught by RESIZE).
const VERBS = String.raw`move|moved|moving|relocate|shift|swap|switch|put|place|add|insert|remove|delete|take\s+out|knock\s+(?:down|through|out)|demolish|close\s+(?:off|up)|block(?:\s+off)?|open\s+up|enlarge|widen|extend|expand|shrink|narrow|resize|convert`;
const NOUNS = String.raw`walls?|windows?|doors?|doorways?|openings?|kitchen|kitchens|partitions?|arch(?:way)?s?|columns?|pillars?|stairs?|staircases?|skylights?|layout|floor\s*plan`;
// "add window shutters", "remove the door handles": the element only names a FINISH on it.
const FINISH_ON = String.raw`frames?|shutters|blinds|curtains?|drapes|treatments?|sills?|handles?|hardware|trim|colou?rs?|finish(?:es)?|paint|tiles?|tiling|panels?|cabinets?|cabinetry|fronts?|counter(?:top)?s?|splashback|backsplash|lights?|lighting|art|mirrors?`;
// Up to two modifier words between the verb and the element, but never a preposition:
// "add curtains to the window" names curtains as the object, not the window.
const PREP = String.raw`to|on|by|near|next|beside|under|over|in|into|at|of|for|with|from|onto|behind|above|below|around|against`;
const MOD = String.raw`(?:(?!(?:${PREP})\b)[a-z0-9-]+\s+){0,2}`;
const STRUCTURAL = new RegExp(String.raw`\b(?:${VERBS})\s+(?:the\s+|a\s+|an\s+|some\s+|all\s+|both\s+|this\s+|that\s+)?${MOD}(?:${NOUNS})\b(?!\s+(?:${FINISH_ON})\b)`, "i");
// "make the windows floor-to-ceiling / bigger", "bigger windows", "the kitchen on the left"
const SIZE = String.raw`bigger|larger|wider|taller|smaller|narrower|floor[-\s]to[-\s]ceiling|full[-\s]height`;
const OPENINGS = String.raw`windows?|doors?|doorways?|openings?|arch(?:way)?s?|skylights?`;
const RESIZE = new RegExp(String.raw`\b(?:${OPENINGS})\b[^.]{0,30}\b(?:${SIZE})\b|\b(?:${SIZE})\s+(?:${OPENINGS})\b`, "i");
const PLACEMENT = new RegExp(String.raw`\b(?:kitchen|windows?|doors?|walls?|openings?)\s+(?:on|to|at)\s+the\s+(?:left|right|other|opposite|back|front|far)\b`, "i");

export interface ChangeRequestClass {
  kind: "structural" | "finish";
  /** The words that decided it (structural only). */
  matched: string | null;
}

export function classifyChangeRequest(text: string): ChangeRequestClass {
  const t = text.replace(/\s+/g, " ").trim();
  const m = STRUCTURAL.exec(t) ?? RESIZE.exec(t) ?? PLACEMENT.exec(t);
  return m ? { kind: "structural", matched: m[0] } : { kind: "finish", matched: null };
}

/** Where the owner adjusts walls, windows and doors: the plan's Openings layer. */
export const planOpeningsHref = (projectId: string) => `/project/${projectId}/plan?layer=openings`;
