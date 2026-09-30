import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatLegalDate, parseInline, parseLegalDocument, plainText, type Block } from "../markdown";

const FM = "---\nstatus: draft\nlast_updated: 2026-09-29\nsource: x.md\n---\n\n";

function allText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === "list" ? b.items.map(plainText).join("\n") : plainText(b.inlines)))
    .join("\n");
}

describe("parseInline", () => {
  it("reads bold, italic and bold inside a sentence", () => {
    expect(parseInline("a **b** *c* d")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " d" },
    ]);
  });
  it("keeps an unmatched marker as text", () => {
    expect(parseInline("5 * 3 and **open")).toEqual([{ text: "5 * 3 and **open" }]);
  });
  it("nests italic inside bold", () => {
    expect(parseInline("**x *y* z**")).toEqual([
      { text: "x ", bold: true },
      { text: "y", bold: true, italic: true },
      { text: " z", bold: true },
    ]);
  });
  it("never produces markup — angle brackets stay text", () => {
    expect(plainText(parseInline("<script>alert(1)</script>"))).toBe("<script>alert(1)</script>");
  });
});

describe("parseLegalDocument", () => {
  it("parses frontmatter, title, headings, quotes, lists and paragraphs", () => {
    const doc = parseLegalDocument(
      `${FM}# Title — RennovAIte\n\n> **DRAFT.** line one\n> line two\n\n*Last updated: [date]*\n\n## 1. One\n\nPara one\ncontinues.\n\n- a\n- **b**\n\nAfter.\n`,
    );
    expect(doc.meta).toEqual({ status: "draft", last_updated: "2026-09-29", source: "x.md" });
    expect(doc.title).toBe("Title — RennovAIte");
    expect(doc.blocks.map((b) => b.type)).toEqual(["quote", "heading", "paragraph", "list", "paragraph"]);
    expect(plainText((doc.blocks[0] as Extract<Block, { type: "quote" }>).inlines)).toBe("DRAFT. line one line two");
    expect(plainText((doc.blocks[2] as Extract<Block, { type: "paragraph" }>).inlines)).toBe("Para one continues.");
    // the body's "Last updated" slot is dropped: the page prints the frontmatter date
    expect(allText(doc.blocks)).not.toMatch(/Last updated/);
  });
  it("refuses a document without frontmatter, status or a valid date", () => {
    expect(() => parseLegalDocument("# T\n")).toThrow(/frontmatter/);
    expect(() => parseLegalDocument("---\nstatus: final\nlast_updated: 2026-09-29\n---\n# T\n")).toThrow(/status/);
    expect(() => parseLegalDocument("---\nstatus: draft\nlast_updated: [date]\n---\n# T\n")).toThrow(/last_updated/);
    expect(() => parseLegalDocument(`${FM}no title\n`)).toThrow(/title/);
  });
  it("handles CRLF files", () => {
    expect(parseLegalDocument(`${FM}# T\n\nx\n`.replace(/\n/g, "\r\n")).title).toBe("T");
  });
});

describe("formatLegalDate", () => {
  it("prints the UTC day", () => expect(formatLegalDate("2026-09-29")).toBe("29 September 2026"));
});

describe.each([
  ["privacy", "Privacy Policy — RennovAIte", 11],
  ["terms", "Terms of Service — RennovAIte", 13],
])("content/legal/%s.md", (key, title, sections) => {
  const doc = parseLegalDocument(readFileSync(path.join(process.cwd(), "content", "legal", `${key}.md`), "utf8"));
  it("parses with its title and every numbered section", () => {
    expect(doc.title).toBe(title);
    const numbered = doc.blocks.filter((b) => b.type === "heading" && /^\d+\./.test(plainText(b.inlines)));
    expect(numbered).toHaveLength(sections);
  });
  it("leaves no Markdown syntax in the rendered text", () => {
    expect(allText(doc.blocks)).not.toMatch(/\*\*|^#|^>|^- /m);
  });
  it("is marked a draft until counsel's text replaces it", () => {
    // Flipping to `published` is the lawyer sign-off; this test is the reminder.
    expect(doc.meta.status).toBe("draft");
    expect(allText(doc.blocks)).toMatch(/DRAFT FOR LEGAL REVIEW/);
  });
});
