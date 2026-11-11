-- Rollback of 20261111180000_expenses.sql. All expense data is lost; receipt photos must be removed in the Storage UI
-- before the bucket row can go (Supabase blocks dropping a non-empty bucket).

drop policy receipts_read on storage.objects;
drop policy receipts_insert on storage.objects;
delete from storage.buckets where id = 'receipts';

drop table public.expenses;
drop table public.expense_book_shares;
drop table public.expense_books;
drop function public.expense_touch();
drop function public.receipt_access(text);
drop function public.expense_book_access(uuid);
drop function public.expense_book_owned(uuid);
