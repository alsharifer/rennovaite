import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Footer } from "@/components/marketing/Footer";
import { TopNav } from "@/components/marketing/TopNav";
import { formatLegalDate, type Block, type Inline, type LegalDocument } from "@/lib/legal/markdown";

// /privacy and /terms (H6): the text is content/legal/<key>.md, rendered as
// React elements from lib/legal/markdown's block tree (never as HTML). While a
// document's status is `draft` it says so above the text and is kept out of
// search indexes; publishing counsel's text is a file swap + `status: published`.

export function legalMetadata(doc: LegalDocument, description: string): Metadata {
  return {
    title: `${doc.title.replace(/\s+—\s+RennovAIte$/, "")} — RennovAIte`,
    description,
    ...(doc.meta.status === "draft" ? { robots: { index: false, follow: false } } : {}),
  };
}

export function LegalPage({ doc }: { doc: LegalDocument }) {
  const draft = doc.meta.status === "draft";
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="mx-auto max-w-[720px] px-md py-3xl pt-32 md:px-margin" data-legal-status={doc.meta.status}>
        <span className="label-caps text-brass-600 tracking-[0.2em]">Legal</span>
        <h1 className="mt-xs font-display text-headline-lg-mobile text-ink-900 md:text-headline-lg">{doc.title}</h1>
        <p className="mt-sm font-body text-body-sm text-ink-500" data-testid="last-updated">
          Last updated {formatLegalDate(doc.meta.last_updated)}
          {draft && " · draft"}
        </p>
        {draft && (
          <p
            className="mt-lg rounded-md border border-brass-600/40 bg-paper px-md py-sm font-body text-body-sm text-ink-700"
            data-testid="legal-draft"
          >
            <span className="font-semibold text-ink-900">Draft — not yet in force.</span> This text is under review by
            counsel and will be replaced by the final version. Questions in the meantime:{" "}
            <a href="mailto:hello@rennovaite.fit" className="focus-ring text-brass-600 underline underline-offset-4">
              hello@rennovaite.fit
            </a>
            .
          </p>
        )}
        <div className="mt-xl">{doc.blocks.map((b, i) => renderBlock(b, i))}</div>
        <Link
          href="/rennovaite"
          className="focus-ring mt-xl inline-flex font-body text-body-sm text-brass-600 hover:underline"
        >
          &larr; Back to RennovAIte
        </Link>
      </main>
      <Footer />
    </div>
  );
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "heading":
      return block.level === 3 ? (
        <h3 key={key} className="mt-lg font-body text-body-lg font-semibold text-ink-900">
          {renderInlines(block.inlines)}
        </h3>
      ) : (
        <h2 key={key} className="mt-xl font-display text-headline-md text-ink-900">
          {renderInlines(block.inlines)}
        </h2>
      );
    case "paragraph":
      return (
        <p key={key} className="mt-md font-body text-body-md text-ink-700">
          {renderInlines(block.inlines)}
        </p>
      );
    case "quote":
      return (
        <blockquote key={key} className="mt-md border-l-4 border-bone pl-md font-body text-body-sm text-ink-500">
          {renderInlines(block.inlines)}
        </blockquote>
      );
    case "list":
      return (
        <ul key={key} className="mt-md list-disc space-y-xs pl-lg font-body text-body-md text-ink-700">
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
    if (p.bold) node = <strong className="font-semibold text-ink-900">{node}</strong>;
    return <span key={i}>{node}</span>;
  });
}
