// T5: pin a PDF's CreationDate / ModDate to the UTC DAY it is generated.
//
// pdf-lib stamps the current instant on every document by default, so two runs
// over identical project state produced different bytes — which made "the button
// output equals a CLI run" unverifiable. The day is what the documents print
// ("dated YYYY-MM-DD"); the metadata now says the same thing.

type DatedPdf = { setCreationDate(d: Date): void; setModificationDate(d: Date): void };

export function pdfDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function stampPdfDay<T extends DatedPdf>(pdf: T, now: Date = new Date()): T {
  const day = pdfDay(now);
  pdf.setCreationDate(day);
  pdf.setModificationDate(day);
  return pdf;
}
