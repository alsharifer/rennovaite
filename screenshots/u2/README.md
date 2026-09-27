# U2 — rate book management UI (2026-09-26, dev)

Captured by `scripts/firm-book-page-check.mjs 3098 --shots=screenshots/u2` —
headless Chrome over the DevTools protocol, **signed in as a real dev account**
(its Supabase session set as the same `sb-<ref>-auth-token` cookie the
magic-link flow writes), driving the page exactly as a member would. Dev DB
(`askzyqgcnjmbqegfifxq`), dev server on 3098. The scratch firm is deleted at
the end of every run.

| File | What it shows |
|---|---|
| `u2-01-firms-list.png` | `/firms` for a signed-in member: **only the caller's firms** (the "other" account's firm, which exists during the run, is absent) and the create form. |
| `u2-02-book-ohp-error.png` | The book page after OH&P was saved at 12.5% and then **80% was refused inline** ("between 0 and 50") — no request was made for the bad value. Status badge reads **Draft**. |
| `u2-03-add-inline-unit-error.png` | Adding `garden.pcc_base` with unit `lm`: the inline error is the vocabulary's own sentence — *garden.pcc_base is measured in "m2", not "lm"* — rendered **before any API call**. |
| `u2-04-entry-beside-reference.png` | The saved entry: **your rate** (AED 95.50 / m²) beside **what it shadows** (AED 105.60 / m² · market reference). Interior items show the built-in pricing they shadow instead. |
| `u2-05-reviewed.png` | The book marked **Reviewed** with its date. |
| `u2-06-edited-back-to-draft.png` | After editing the entry to 96.25 (a negative rate having been refused inline first): the status is **Draft** again — a reviewed book that changed is a different book. |
| `u2-07-not-a-member.png` | This member opening the OTHER account's firm URL: the not-a-member card, no editor, no entries — and the API answered that account 403 for this book. |

The run's network log (24 checks, all passed) showed **12 API requests, every one
to `/api/firms/<this firm>…`, `/api/firms` or `/api/rate-vocabulary`** — none to
any other firm.
