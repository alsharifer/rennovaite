// =============================================================================
// components/blueprint/Icon.tsx — the one icon component (R7 §1.6, Figma 8:50).
//
// Material Symbols SHARP by ligature: weight 300, grade 0, optical size 20
// (the .bp-icon class in app/globals.css; the font is the <link> in
// app/layout.tsx). No SVG icon libraries. Decorative by default (aria-hidden);
// give it a `label` when it stands alone and means something.
//
// SIZE: `size` (px) or a text-[…] class both work — .bp-icon is in the
// components layer, so utilities and the inline size outrank its 20 px. (The
// Atelier icon class is unlayered at 24 px and ignores text-* — that trap must
// not reach Blueprint; /dev/blueprint and a test check it.)
// =============================================================================

export function Icon({ name, label, size, className }: { name: string; label?: string; size?: number; className?: string }) {
  return (
    <span
      className={`bp-icon${className ? ` ${className}` : ""}`}
      {...(size ? { style: { fontSize: size } } : {})}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      translate="no"
    >
      {name}
    </span>
  );
}
