// =============================================================================
// lib/legal/markdown.ts — the legal pages' document format (H6).
//
// /privacy and /terms render Markdown files from content/legal/, so the
// lawyer-approved text replaces the draft by swapping a file, not by editing a
// page. This is a deliberately SMALL Markdown: exactly what those documents
// use — a frontmatter block, `#`/`##`/`###` headings, paragraphs, `>` quotes,
// `-` lists, `**bold**` and `*italic*`. Anything else is kept as literal text.
//
// The output is a plain block tree, never HTML: the page renders it as React
// elements, so nothing in a document can inject markup.
//
// Frontmatter carries what the page prints around the text:
//   status        draft | published — a draft is marked as such and noindexed
//   last_updated  YYYY-MM-DD — the page's "Last updated" line
//   source        where the text came from (the counsel draft's file name)
// The body's own `*Last updated: …*` line is a template slot (the drafts carry
// `[date]` there); it is dropped and the page prints the frontmatter date.
// =============================================================================

export type LegalStatus = "draft" | "published";

export interface LegalMeta {
  status: LegalStatus;
  last_updated: string;
  source: string | null;
}

export interface Inline {
  text: string;
  bold?: true;
  italic?: true;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "quote"; inlines: Inline[] }
  | { type: "list"; items: Inline[][] };

export interface LegalDocument {
  meta: LegalMeta;
  /** The first `#` heading, as plain text. */
  title: string;
  /** Every block after the title. */
  blocks: Block[];
}

const LAST_UPDATED_SLOT = /^\*Last updated:.*\*$/i;

export function parseLegalDocument(source: string): LegalDocument {
  const { meta, body } = splitFrontmatter(source.replace(/\r\n?/g, "\n"));
  const blocks = parseBlocks(body);
  const titleAt = blocks.findIndex((b) => b.type === "heading" && b.level === 1);
  if (titleAt < 0) throw new Error("legal document has no `#` title");
  const title = plainText((blocks[titleAt] as { inlines: Inline[] }).inlines);
  return { meta, title, blocks: blocks.filter((_, i) => i !== titleAt) };
}

function splitFrontmatter(src: string): { meta: LegalMeta; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error("legal document has no frontmatter");
  const fields = new Map<string, string>();
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) fields.set(kv[1]!, kv[2]!.trim());
  }
  const status = fields.get("status");
  if (status !== "draft" && status !== "published") throw new Error(`legal document status must be draft or published, got ${status ?? "nothing"}`);
  const last = fields.get("last_updated") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(last) || Number.isNaN(Date.parse(`${last}T00:00:00Z`))) {
    throw new Error(`legal document last_updated must be YYYY-MM-DD, got ${last || "nothing"}`);
  }
  return { meta: { status, last_updated: last, source: fields.get("source") || null }, body: src.slice(m[0].length) };
}

function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) {
      const text = para.join(" ");
      if (!LAST_UPDATED_SLOT.test(text.trim())) blocks.push({ type: "paragraph", inlines: parseInline(text) });
    }
    if (quote.length) blocks.push({ type: "quote", inlines: parseInline(quote.join(" ")) });
    if (list.length) blocks.push({ type: "list", items: list.map((item) => parseInline(item)) });
    para = [];
    quote = [];
    list = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3, inlines: parseInline(heading[2]!) });
      continue;
    }
    if (line.startsWith(">")) {
      if (para.length || list.length) flush();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item && !/^\*\*/.test(line) && !(line.startsWith("*") && line.endsWith("*"))) {
      if (para.length || quote.length) flush();
      list.push(item[1]!);
      continue;
    }
    if (quote.length || list.length) flush();
    para.push(line);
  }
  flush();
  return blocks;
}

/** `**bold**` and `*italic*`, nestable one level; an unmatched marker is text. */
export function parseInline(text: string, inherited: Omit<Inline, "text"> = {}): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const push = (t: string, style: Omit<Inline, "text">) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && !!last.bold === !!style.bold && !!last.italic === !!style.italic) last.text += t;
    else out.push({ text: t, ...style });
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        push(buf, inherited);
        buf = "";
        for (const part of parseInline(text.slice(i + 2, end), { ...inherited, bold: true })) push(part.text, part);
        i = end + 2;
        continue;
      }
    } else if (text[i] === "*") {
      const end = findSingleStar(text, i + 1);
      if (end > i + 1) {
        push(buf, inherited);
        buf = "";
        for (const part of parseInline(text.slice(i + 1, end), { ...inherited, italic: true })) push(part.text, part);
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  push(buf, inherited);
  return out.map((p) => {
    const clean: Inline = { text: p.text };
    if (p.bold) clean.bold = true;
    if (p.italic) clean.italic = true;
    return clean;
  });
}

function findSingleStar(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] !== "*") continue;
    if (text[j + 1] === "*") {
      j += 1;
      continue;
    }
    return j;
  }
  return -1;
}

export function plainText(inlines: Inline[]): string {
  return inlines.map((p) => p.text).join("");
}

/** "2026-09-29" → "29 September 2026" (UTC, so every server prints the same day). */
export function formatLegalDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}
