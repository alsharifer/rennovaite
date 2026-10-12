"use client";

// The legal template's contents (K8 #14, 65:1480): 220 px, the section in view
// marked by a brass 2 px left rule (aria-current). Scroll-spy over the
// article's section headings; a link jumps to its section.

import { useEffect, useState } from "react";

export function LegalToc({ sections }: { sections: { id: string; title: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? null);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);
  return (
    <nav aria-labelledby="legal-toc-h" className="hidden lg:block">
      <h2 id="legal-toc-h" className="t-label-caps text-bp-ink-tertiary">
        ON THIS PAGE
      </h2>
      <ol className="mt-2 border-l border-bp-line-hairline">
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? "location" : undefined}
                className={`-ml-px block border-l-2 py-1.5 pl-3 ${on ? "t-nav-item-active border-bp-brass text-bp-ink-primary" : "t-body-sm border-transparent text-bp-ink-secondary hover:text-bp-ink-primary"}`}
              >
                {s.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
