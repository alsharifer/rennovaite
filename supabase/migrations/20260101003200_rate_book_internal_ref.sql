-- 032_rate_book_internal_ref.sql — where a rate's source document is named.
--
-- `rate_book.source` is surfaced: it reaches the what-if engine, the BoQ line's
-- vendor_or_source, and therefore the client. That is deliberate — citing where
-- a rate came from is the transparency the product rests on.
--
-- The garden rates (G2) are different. They are one independent contractor's
-- negotiated prices, shared in confidence, and the client they would reach is a
-- competitor's. So the firm's name goes HERE, and `source` carries a neutral
-- market-reference label instead. Nothing renders this column; it exists so a
-- rate can still be traced back to its document internally.
--
-- Additive and nullable — every existing row is untouched.

alter table public.rate_book add column if not exists internal_ref text;

comment on column public.rate_book.internal_ref is
  'Internal provenance (source document / counterparty). NEVER rendered — use source for anything client-facing.';

notify pgrst, 'reload schema';
