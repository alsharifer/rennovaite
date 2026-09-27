-- 044_firm_book_status.sql — a firm's book is a DRAFT until the firm says it is
-- reviewed (U2).
--
--   status       draft | reviewed. Every book starts as draft. Marking it
--                reviewed is an explicit act by a member (PATCH /api/firms/:id
--                { status: "reviewed" }); ANY later change to the book — an
--                entry added, edited or deleted, the OH&P moved — puts it back
--                to draft, because a review of a book that has since changed
--                is a review of a different book.
--   reviewed_at  when it was last marked reviewed; cleared on the way back.
--
-- Nothing prices differently on status: resolution (lib/rates/tiers.ts) is
-- unchanged. U5's export gate is the consumer — a project priced by a draft
-- book is not ready to leave as a document.

alter table public.firm_rate_books
  add column if not exists status text not null default 'draft',
  add column if not exists reviewed_at timestamptz;

alter table public.firm_rate_books drop constraint if exists firm_rate_books_status_chk;
alter table public.firm_rate_books
  add constraint firm_rate_books_status_chk check (status in ('draft', 'reviewed'));
