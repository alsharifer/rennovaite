# U3 — structured quote import with review (2026-09-27, dev)

Captured by `scripts/quote-import-check.mjs 3098 --shots=screenshots/u3`:
the whole path runs through the real routes as an authenticated dev account
(template → filled xlsx → upload → confirm → accept → BoQ dry-run → re-import),
and headless Chrome, signed in with the same session cookie, captures the review
screen. Dev DB, dev server on 3098. The scratch firm and everything under it
(quotes, lines, entries) is deleted at the end of every run.

| File | What it shows |
|---|---|
| `u3-01-review-before.png` | The quotation just uploaded, **in review**: six lines, each with the quoted figure, a **suggested** item with its score (nothing confirmed), and the three held lines with their reasons — *currency USD — no exchange rate is applied*, *"on request" is not a number*, *no matching item*. The book is untouched at this point. |
| `u3-02-review-accepted.png` | After "confirm suggestions ≥ 0.5" and **Accept**: three lines *In book* with the rate they entered as beside what they shadow (PCC 98.50 vs the 105.60 market reference), three still *Held* — on the record, with reasons, not imported. The quote reads **Accepted**. |
| `u3-03-book-with-quote-rates.png` | The firm's book: the three quote-import entries marked *from a quotation*, beside their references; the Quotations panel lists the quote as accepted. |

The run's assertions (27, all passed) also covered what a screenshot cannot: every
entry carries `origin = quote_import` and the quote's id; the BoQ dry-run priced
PCC at 98.5 under the constant label *contractor rate book (supplier quotation)*
with the supplier's label and reference appearing nowhere; a second accept is
409; re-importing the same reference made **version 2**, whose accept
superseded v1's entry (active count unchanged, superseded row kept, v1 marked
superseded with its links intact) and moved the BoQ to v2's 101.
