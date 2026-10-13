// =============================================================================
// components/blueprint/legal/LegalTemplate.tsx — /privacy and /terms (K8 #14,
// spec §6.8, Figma 65:1480). Public, no rail: the wordmark and Sign in; the
// contents (220) beside the article (720); while the text is not signed off,
// the inverse band "DRAFT — BEING FINALISED WITH COUNSEL"; a footer with both
// documents. The text itself is H6's: counsel's document (content/legal/*.md,
// rendered from lib/legal/markdown's block tree — never as HTML) once it says
// `status: published`, the "being finalised" placeholder until then.
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatLegalDate, plainText, type Block, type Inline, type LegalDocument } from "@/lib/legal/markdown";

import { LegalToc } from "./LegalToc";

/** Robots for /privacy and /terms: noindex while invite-only. Lift with the public landing. */
export const LEGAL_ROBOTS: NonNullable<Metadata["robots"]> = { index: false, follow: false };

export function legalMetadata(doc: LegalDocument, description: string): Metadata {
  return {
    // Counsel's drafts still spell the name RennovAIte; the tab title carries the brand either way.
    title: `${doc.title.replace(/\s+—\s+Renn?ovAIte$/, "")} — RenovAIte`,
    description,
    robots: LEGAL_ROBOTS,
  };
}

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function LegalTemplate({ title, sections, band, intro }: { title: string; sections: LegalSection[]; band: string | null; intro?: ReactNode }) {
  const year = new Date().getUTCFullYear();
  return (
    <div data-system="blueprint" className="flex min-h-screen flex-col bg-bp-surface-base font-bp-sans text-bp-ink-primary" data-legal>
      <header className="flex h-[72px] items-center justify-between border-b border-bp-line-hairline px-6 lg:px-16">
        {/* Not a link: "/" redirects, and nothing public links into a redirect (front door). */}
        <span className="t-heading-md text-bp-ink-primary">RenovAIte</span>
        <Link href="/auth" className="t-nav-item-active inline-flex h-9 items-center border border-bp-line-control px-4 text-bp-ink-primary hover:bg-bp-surface-sunken">
          Sign in
        </Link>
      </header>
      <div className="mx-auto grid w-full max-w-[1312px] flex-1 grid-cols-1 gap-16 px-6 py-14 lg:grid-cols-[220px_minmax(0,720px)] lg:px-16">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <LegalToc sections={sections.map(({ id, title: t }) => ({ id, title: t }))} />
        </div>
        <main id="main" className="min-w-0">
          <p className="t-label-caps text-bp-brass-text">LEGAL</p>
          <h1 className="t-display-serif mt-3 text-bp-ink-primary">{title}</h1>
          {band ? (
            <p className="surface-inverse t-label-caps mt-4 bg-bp-alert-surface px-3.5 py-2.5 text-bp-alert-ink" data-testid="legal-draft">
              {band}
            </p>
          ) : null}
          {intro}
          {sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id} className="mt-7">
              <h2 id={s.id} className="t-heading-md scroll-mt-8 text-bp-ink-primary">
                {s.title}
              </h2>
              <div className="t-body-md mt-3 text-bp-ink-primary">{s.body}</div>
            </section>
          ))}
        </main>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-bp-line-hairline px-6 py-7 lg:px-16">
        <p className="t-label-md font-bp-mono text-bp-ink-secondary">© {year} RenovAIte · Dubai</p>
        <nav aria-label="Legal" className="flex gap-6">
          <Link href="/privacy" className="t-body-sm text-bp-ink-secondary hover:text-bp-ink-primary">
            Privacy
          </Link>
          <Link href="/terms" className="t-body-sm text-bp-ink-secondary hover:text-bp-ink-primary">
            Terms
          </Link>
        </nav>
      </footer>
    </div>
  );
}

/** Counsel's document, one section per "## " heading (anything before the first sits in the intro). */
export function LegalDocumentPage({ doc }: { doc: LegalDocument }) {
  const draft = doc.meta.status === "draft";
  const intro: Block[] = [];
  const sections: { title: string; blocks: Block[] }[] = [];
  for (const b of doc.blocks) {
    if (b.type === "heading" && b.level === 2) sections.push({ title: plainText(b.inlines), blocks: [] });
    else (sections.at(-1)?.blocks ?? intro).push(b);
  }
  const used = new Set<string>();
  return (
    <LegalTemplate
      title={doc.title.replace(/\s+—\s+Renn?ovAIte$/, "")}
      band={draft ? `DRAFT — BEING FINALISED WITH COUNSEL · LAST UPDATED ${formatLegalDate(doc.meta.last_updated).toUpperCase()}` : null}
      intro={
        <>
          {!draft ? (
            <p className="t-label-md mt-3 font-bp-mono text-bp-ink-secondary" data-testid="last-updated">
              Last updated {formatLegalDate(doc.meta.last_updated)}
            </p>
          ) : null}
          {intro.length ? <div className="t-body-md mt-5">{intro.map(renderBlock)}</div> : null}
        </>
      }
      sections={sections.map((s) => {
        let id = slug(s.title) || "section";
        while (used.has(id)) id += "-x";
        used.add(id);
        return { id, title: s.title, body: s.blocks.map(renderBlock) };
      })}
    />
  );
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading":
      return (
        <h3 key={key} className="t-heading-sm mt-5 text-bp-ink-primary">
          {renderInlines(block.inlines)}
        </h3>
      );
    case "paragraph":
      return (
        <p key={key} className="mt-3 first:mt-0">
          {renderInlines(block.inlines)}
        </p>
      );
    case "quote":
      return (
        <blockquote key={key} className="t-body-sm mt-3 border-l-2 border-bp-line-strong pl-4 text-bp-ink-secondary">
          {renderInlines(block.inlines)}
        </blockquote>
      );
    case "list":
      return (
        <ul key={key} className="mt-3 list-disc space-y-1.5 pl-6">
          {block.items.map((item, i) => (
            <li key={i}>{renderInlines(item)}</li>
          ))}
        </ul>
      );
  }
}

function renderInlines(inlines: Inline[]): ReactNode[] {
  return inlines.map((p, i) => {
    let node: ReactNode = p.text;
    if (p.italic) node = <em>{node}</em>;
    if (p.bold) node = <strong className="font-semibold">{node}</strong>;
    return <span key={i}>{node}</span>;
  });
}
