// =============================================================================
// lib/icons/ready.ts — the pre-paint check that reveals the icons (K10 #6).
//
// Icons render by ligature: before the font arrives a span reads "open_in_new".
// app/globals.css keeps every icon transparent until <html data-icons="ready">;
// this inline script (in <head>, before the body paints) asks the browser to
// load the self-hosted Material Symbols Sharp subset and sets the mark once a
// face is actually loaded. If the font never loads the icons stay invisible —
// never their names. A browser without the Font Loading API gets the mark at
// once (it cannot tell; such browsers are not in the pilot's support list).
// =============================================================================

export const ICONS_READY_SCRIPT = `(function(){var d=document.documentElement;function ready(){d.setAttribute("data-icons","ready")}try{var f=document.fonts;if(!f||!f.load){ready();return}f.load('20px "Material Symbols Sharp"',"home").then(function(l){if(l&&l.length)ready()},function(){});}catch(e){ready()}})();`;
