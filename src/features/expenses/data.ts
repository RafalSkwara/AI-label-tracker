import type { Category, ReceiptItem, ReceiptRead } from "@/lib/receipt";
import { supabase } from "@/lib/supabase";

/** Own expense books and books shared with the user by e-mail (RLS). Removal is soft: archived_at. */
export type Book = { id: string; owner_id: string; owner_email: string | null; name: string };
export type Expense = {
  id: string;
  book_id: string;
  created_by: string;
  spent_on: string;
  shop: string | null;
  total: number;
  category: Category;
  note: string | null;
  items: ReceiptItem[];
  list_id: string | null;
  photo_path: string | null;
};
export type ExpenseFields = Omit<Expense, "id" | "created_by">;

const BOOK_COLS = "id,owner_id,owner_email,name";
const EXP_COLS = "id,book_id,created_by,spent_on,shop,total,category,note,items,list_id,photo_path";
const BUCKET = "receipts";
const now = () => new Date().toISOString();

async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error || data == null) throw new Error(error?.message ?? "brak odpowiedzi");
  return data as T;
}
// numeric columns arrive as strings
const num = (e: Expense): Expense => ({ ...e, total: Number(e.total) });

export async function loadExpenses(): Promise<{ books: Book[]; expenses: Expense[] }> {
  const db = supabase();
  const [books, expenses] = await Promise.all([
    must<Book[]>(db.from("expense_books").select(BOOK_COLS).is("archived_at", null).order("created_at")),
    must<Expense[]>(db.from("expenses").select(EXP_COLS).is("archived_at", null).order("spent_on", { ascending: false }).order("created_at", { ascending: false })),
  ]);
  return { books, expenses: expenses.map(num) };
}

export const insertBook = (name: string) => must<Book>(supabase().from("expense_books").insert({ name }).select(BOOK_COLS).single());
export const renameBook = (id: string, name: string) => must<Book>(supabase().from("expense_books").update({ name }).eq("id", id).select(BOOK_COLS).single());
export const archiveBook = (id: string) => must<Book>(supabase().from("expense_books").update({ archived_at: now() }).eq("id", id).select(BOOK_COLS).single());

/** id is chosen by the app so the photo can be uploaded under it before the row exists */
export const insertExpense = (id: string, f: ExpenseFields) =>
  must<Expense>(supabase().from("expenses").insert({ id, ...f }).select(EXP_COLS).single()).then(num);
export const updateExpense = (id: string, f: Partial<ExpenseFields>) =>
  must<Expense>(supabase().from("expenses").update(f).eq("id", id).select(EXP_COLS).single()).then(num);
/** archived = false restores (undo) */
export const archiveExpense = (id: string, archived = true) =>
  must<Expense>(supabase().from("expenses").update({ archived_at: archived ? now() : null }).eq("id", id).select(EXP_COLS).single()).then(num);

/** Uploads the photo as "<book>/<expense>.jpg"; returns the path */
export async function uploadPhoto(bookId: string, expenseId: string, jpeg: Blob): Promise<string> {
  const path = `${bookId}/${expenseId}.jpg`;
  const { error } = await supabase().storage.from(BUCKET).upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function photoUrl(path: string): Promise<string> {
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data) throw new Error(error?.message ?? "brak zdjęcia");
  return data.signedUrl;
}

/** Sends the photo to the Worker (Workers AI); the result is a draft the user checks */
export async function readReceipt(dataUrl: string): Promise<ReceiptRead> {
  const { data } = await supabase().auth.getSession();
  const res = await fetch("/api/receipts/read", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ image: dataUrl }),
  });
  if (!res.ok) throw new Error(res.status === 400 ? "zdjęcie jest za duże lub ma zły format" : "nie udało się odczytać paragonu");
  return (await res.json()) as ReceiptRead;
}
