// =============================================================================
// components/blueprint/Icon.tsx — the one icon component (R7 §1.6, Figma 8:50).
//
// Material Symbols SHARP by ligature: weight 300, grade 0, optical size 20
// (the .bp-icon class in app/globals.css; the font is the <link> in
// app/layout.tsx). No SVG icon libraries. Decorative by default (aria-hidden);
// give it a `label` when it stands alone and means something.
// =============================================================================

export function Icon({ name, label, className }: { name: string; label?: string; className?: string }) {
  return (
    <span
      className={`bp-icon${className ? ` ${className}` : ""}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      translate="no"
    >
      {name}
    </span>
  );
}
