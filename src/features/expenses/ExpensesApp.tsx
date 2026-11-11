"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addShare, EXPENSES, loadShares, removeShare, type Shares, sharedLabel } from "@/features/sharing/data";
import ShareSheet from "@/features/sharing/ShareSheet";
import { loadShopping, updateItem } from "@/features/shopping/data";
import { fmtPrice } from "@/features/shopping/money";
import type { ShoppingItem, ShoppingList } from "@/features/shopping/types";
import { localToday, shortDay } from "@/lib/calendar";
import { CATEGORIES, type Category, type ReceiptRead } from "@/lib/receipt";
import { archiveBook, archiveExpense, type Book, type Expense, type ExpenseFields, insertBook, insertExpense, loadExpenses, readReceipt, renameBook, updateExpense, uploadPhoto } from "./data";
import ExpenseSheet, { type Tick } from "./ExpenseSheet";
import { shrinkPhoto } from "./image";
import s from "./expenses.module.css";

const MONTHS = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
const BOOK_KEY = "expenses-book";
const plural = (n: number) => (n === 1 ? "wydatek" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "wydatki" : "wydatków");
function shiftMonth(ym: string, n: number) {
  const m = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
}

// lists are only for linking: a failure there must not hide expenses
const shoppingOrEmpty = () => loadShopping().catch((): { lists: ShoppingList[]; items: ShoppingItem[] } => ({ lists: [], items: [] }));

type NewSheet = { kind: "new"; read: ReceiptRead | null; preview: string | null; blob: Blob | null; reading: boolean; readError: string };
type SheetState = NewSheet | { kind: "edit"; expense: Expense } | null;

/** Household expenses: monthly summary per budget (own or shared), receipts read from a photo, link to shopping lists */
export default function ExpensesApp({ userId, email }: { userId: string; email: string }) {
  const today = localToday();
  const [books, setBooks] = useState<Book[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [listItems, setListItems] = useState<ShoppingItem[]>([]);
  const [shares, setShares] = useState<Shares>({});
  const [bookId, setBookId] = useState(() => { try { return localStorage.getItem(BOOK_KEY) ?? ""; } catch { return ""; } });
  const [month, setMonth] = useState(today.slice(0, 7));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [booksOpen, setBooksOpen] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);
  const readSeq = useRef(0);

  const flash = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3200);
  }, []);
  const fail = useCallback((e: unknown) => flash(`Nie zapisano: ${(e as Error).message}`), [flash]);

  const reload = useCallback(async () => {
    try {
      const [d, sh, shop] = await Promise.all([loadExpenses(), loadShares(EXPENSES), shoppingOrEmpty()]);
      let bs = d.books;
      // first visit: every user gets one own budget to start with
      if (!seeded.current && !bs.some((b) => b.owner_id === userId)) {
        seeded.current = true;
        bs = [...bs, await insertBook("Domowe")];
      }
      setBooks(bs); setExpenses(d.expenses); setShares(sh); setLists(shop.lists); setListItems(shop.items); setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [userId, setBooks, setExpenses, setShares, setLists, setListItems, setError, setLoaded]);

  useEffect(() => {
    // initial load: setState happens after the awaited fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(toastTimer.current); };
  }, [reload]);

  const book = books.find((b) => b.id === bookId) ?? books.find((b) => b.owner_id === userId) ?? books[0];
  const pickBook = (id: string) => { setBookId(id); try { localStorage.setItem(BOOK_KEY, id); } catch { /* private mode */ } };

  const inBook = useMemo(() => expenses.filter((e) => e.book_id === book?.id), [expenses, book]);
  const ofMonth = useMemo(() => inBook.filter((e) => e.spent_on.startsWith(month)), [inBook, month]);
  const prevTotal = useMemo(() => inBook.filter((e) => e.spent_on.startsWith(shiftMonth(month, -1))).reduce((a, e) => a + e.total, 0), [inBook, month]);
  const total = ofMonth.reduce((a, e) => a + e.total, 0);
  const byCat = useMemo(() => {
    const m = new Map<Category, number>();
    for (const e of ofMonth) m.set(e.category, (m.get(e.category) ?? 0) + e.total);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [ofMonth]);
  const byShop = useMemo(() => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const e of ofMonth) {
      const k = e.shop ?? "bez sklepu";
      const v = m.get(k) ?? { sum: 0, n: 0 };
      m.set(k, { sum: v.sum + e.total, n: v.n + 1 });
    }
    return [...m].sort((a, b) => b[1].sum - a[1].sum).slice(0, 5);
  }, [ofMonth]);

  async function onPhoto(file: File) {
    const seq = ++readSeq.current;
    let shrunk: { blob: Blob; dataUrl: string };
    try { shrunk = await shrinkPhoto(file); } catch (e) { return flash(`Zdjęcie: ${(e as Error).message}`); }
    setSheet({ kind: "new", read: null, preview: shrunk.dataUrl, blob: shrunk.blob, reading: true, readError: "" });
    let read: ReceiptRead | null = null, readError = "";
    try { read = await readReceipt(shrunk.dataUrl); } catch (e) { readError = (e as Error).message; }
    // ignore a late answer for a sheet the user already closed or replaced
    if (seq !== readSeq.current) return;
    setSheet((st) => (st?.kind === "new" && st.reading ? { ...st, read, readError, reading: false } : st));
  }

  async function save(fields: ExpenseFields, ticks: Tick[]) {
    const st = sheet;
    if (!st) return;
    setSheet(null);
    try {
      if (st.kind === "edit") {
        const saved = await updateExpense(st.expense.id, fields);
        setExpenses((l) => l.map((e) => (e.id === saved.id ? saved : e)));
        flash("Zapisano");
        return;
      }
      const id = crypto.randomUUID();
      let photo: string | null = null, photoFailed = false;
      if (st.blob) {
        try { photo = await uploadPhoto(fields.book_id, id, st.blob); } catch { photoFailed = true; }
      }
      const saved = await insertExpense(id, { ...fields, photo_path: photo });
      setExpenses((l) => [saved, ...l]);
      if (saved.spent_on.slice(0, 7) !== month) setMonth(saved.spent_on.slice(0, 7));
      let ticked = 0;
      for (const t of ticks) {
        try {
          const it = await updateItem(t.itemId, t.price == null ? { checked: true } : { checked: true, price: t.price });
          setListItems((l) => l.map((x) => (x.id === it.id ? it : x)));
          ticked++;
        } catch { /* the expense is saved; a list item may have been removed meanwhile */ }
      }
      flash([`Dodano ${fmtPrice(saved.total)}`, ticked ? `odhaczono ${ticked} na liście` : "", photoFailed ? "bez zdjęcia (błąd wysyłki)" : ""].filter(Boolean).join(", "));
    } catch (e) { fail(e); }
  }

  async function remove(exp: Expense) {
    setSheet(null);
    setExpenses((l) => l.filter((e) => e.id !== exp.id));
    try {
      await archiveExpense(exp.id);
      flash(`Usunięto ${fmtPrice(exp.total)}`, async () => {
        setToast(null);
        try { const back = await archiveExpense(exp.id, false); setExpenses((l) => [back, ...l].sort((a, b) => b.spent_on.localeCompare(a.spent_on))); } catch (e) { fail(e); }
      });
    } catch (e) { setExpenses((l) => [exp, ...l]); fail(e); }
  }

  const shareInfo = (b: Book) => b.owner_id !== userId ? `od ${b.owner_email ?? "innej osoby"}` : (shares[b.id]?.length ? sharedLabel(shares[b.id].length, "Udostępniony") : "");

  if (!loaded) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;

  const [y, m] = [month.slice(0, 4), +month.slice(5, 7)];
  const diff = total - prevTotal;
  const days = [...new Set(ofMonth.map((e) => e.spent_on))];
  const sharingBook = books.find((b) => b.id === sharing);

  return (
    <main className={s.page}>
      {error && <div className="banner"><span>{error}</span><button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
      <nav className="seg" aria-label="Zakupy">
        <Link href="/zakupy">Listy</Link>
        <Link href="/wydatki" aria-current="page">Wydatki</Link>
      </nav>

      <div className={s.head}>
        {books.length > 1
          ? <select className={s.bookpick} aria-label="Budżet" value={book?.id ?? ""} onChange={(e) => pickBook(e.target.value)}>
              {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          : <h1 className={s.bookname}>{book?.name ?? "Wydatki"}</h1>}
        <button className="btn" onClick={() => setBooksOpen(true)}>👥 {book && shareInfo(book) ? shareInfo(book) : "Budżety"}</button>
      </div>

      <div className={s.adds}>
        <button className="btn primary" disabled={!book} onClick={() => fileRef.current?.click()}>📷 Paragon</button>
        <button className="btn" disabled={!book} onClick={() => setSheet({ kind: "new", read: null, preview: null, blob: null, reading: false, readError: "" })}>+ Ręcznie</button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPhoto(f); }} />
      </div>

      <section className={s.summary} aria-label="Podsumowanie miesiąca">
        <div className={s.monthnav}>
          <button className={s.nav} aria-label="Poprzedni miesiąc" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <strong>{MONTHS[m - 1]} {y}</strong>
          <button className={s.nav} aria-label="Następny miesiąc" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <div className={s.total}>{fmtPrice(total)}</div>
        <p className="sub">
          {ofMonth.length} {plural(ofMonth.length)}
          {prevTotal > 0 && <> · {diff >= 0 ? "+" : "−"}{fmtPrice(Math.abs(diff))} vs {MONTHS[(m + 10) % 12].toLowerCase()}</>}
        </p>
        {byCat.length > 0 && (
          <ul className={s.cats}>
            {byCat.map(([c, v]) => (
              <li key={c}>
                <span>{CATEGORIES[c]}</span><span className={s.amt}>{fmtPrice(v)}</span>
                <span className={s.barwrap}><span className={s.bar} style={{ width: `${Math.max(2, (v / byCat[0][1]) * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        )}
        {byShop.length > 1 && (
          <p className="sub">Sklepy: {byShop.map(([k, v]) => `${k} ${fmtPrice(v.sum)}`).join(" · ")}</p>
        )}
      </section>

      {ofMonth.length === 0 && !error && <div className="empty"><strong>Brak wydatków w tym miesiącu</strong>Zrób zdjęcie paragonu albo dodaj wydatek ręcznie.</div>}
      {days.map((d) => (
        <section key={d}>
          <h2 className={s.day}>{shortDay(d)}</h2>
          <ul className={s.list}>
            {ofMonth.filter((e) => e.spent_on === d).map((e) => (
              <li key={e.id}>
                <button className={s.item} onClick={() => setSheet({ kind: "edit", expense: e })}>
                  <span className={s.what}>
                    <span className={s.title}>{e.shop ?? CATEGORIES[e.category]}{e.photo_path && " 🧾"}</span>
                    <span className="sub">{CATEGORIES[e.category]}{e.items.length > 0 && ` · ${e.items.length} poz.`}{e.created_by !== userId && " · dodane przez inną osobę"}</span>
                  </span>
                  <span className={s.amt}>{fmtPrice(e.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {sheet && book && (
        <ExpenseSheet
          key={sheet.kind === "edit" ? sheet.expense.id : `new-${sheet.reading}`}
          expense={sheet.kind === "edit" ? sheet.expense : null}
          read={sheet.kind === "new" ? sheet.read : null}
          preview={sheet.kind === "new" ? sheet.preview : null}
          reading={sheet.kind === "new" && sheet.reading}
          readError={sheet.kind === "new" ? sheet.readError : ""}
          today={today}
          books={books}
          bookId={book.id}
          lists={lists}
          listItems={listItems}
          onSave={save}
          onRemove={remove}
          onClose={() => { readSeq.current++; setSheet(null); }}
        />
      )}

      {booksOpen && (
        <BooksSheet
          books={books} userId={userId} current={book?.id ?? ""} shareInfo={shareInfo}
          onPick={(id) => { pickBook(id); setBooksOpen(false); }}
          onShare={(b) => setSharing(b.id)}
          onRename={async (b, name) => { try { const nb = await renameBook(b.id, name); setBooks((l) => l.map((x) => (x.id === nb.id ? nb : x))); } catch (e) { fail(e); } }}
          onArchive={async (b) => { try { await archiveBook(b.id); setBooks((l) => l.filter((x) => x.id !== b.id)); } catch (e) { fail(e); } }}
          onAdd={async (name) => { try { const nb = await insertBook(name); setBooks((l) => [...l, nb]); pickBook(nb.id); } catch (e) { fail(e); } }}
          onClose={() => setBooksOpen(false)}
        />
      )}

      {sharingBook && (
        <ShareSheet
          what={`budżet „${sharingBook.name}”`}
          emails={(shares[sharingBook.id] ?? []).filter((x) => x !== email)}
          owner={sharingBook.owner_id === userId}
          ownerEmail={sharingBook.owner_email}
          onAdd={async (x) => { await addShare(EXPENSES, sharingBook.id, x); setShares((sh) => ({ ...sh, [sharingBook.id]: [...(sh[sharingBook.id] ?? []), x] })); }}
          onRemove={async (x) => { await removeShare(EXPENSES, sharingBook.id, x); setShares((sh) => ({ ...sh, [sharingBook.id]: (sh[sharingBook.id] ?? []).filter((y) => y !== x) })); }}
          onLeave={async () => {
            await removeShare(EXPENSES, sharingBook.id, email);
            setBooks((l) => l.filter((b) => b.id !== sharingBook.id)); setExpenses((l) => l.filter((e) => e.book_id !== sharingBook.id));
            setSharing(null); setBooksOpen(false); flash(`Opuszczono budżet „${sharingBook.name}”`);
          }}
          onClose={() => setSharing(null)}
        />
      )}

      {toast && (
        <div className={`toast ${s.toast}`} role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button className={s.undo} onClick={toast.undo}>Cofnij</button>}
        </div>
      )}
    </main>
  );
}

type BooksProps = {
  books: Book[]; userId: string; current: string; shareInfo: (b: Book) => string;
  onPick: (id: string) => void; onShare: (b: Book) => void; onRename: (b: Book, name: string) => void;
  onArchive: (b: Book) => void; onAdd: (name: string) => void; onClose: () => void;
};

/** Budgets: pick, rename, share (owner) or see whose it is (recipient), add another */
function BooksSheet({ books, userId, current, shareInfo, onPick, onShare, onRename, onArchive, onAdd, onClose }: BooksProps) {
  const [name, setName] = useState("");
  const [armed, setArmed] = useState("");
  const own = books.filter((b) => b.owner_id === userId);
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet ${s.books}`} role="dialog" aria-label="Budżety">
        <strong>Budżety</strong>
        <p className="sub">Wydatki w budżecie widzą i dodają wszystkie osoby, którym go udostępnisz.</p>
        {books.map((b) => {
          const mine = b.owner_id === userId;
          return (
            <div key={b.id} className={s.bookrow}>
              {mine
                ? <input className={s.bname} key={b.name} defaultValue={b.name} maxLength={60} aria-label="Nazwa budżetu"
                    onBlur={(e) => { const v = e.target.value.trim(); if (!v) e.target.value = b.name; else if (v !== b.name) onRename(b, v); }} />
                : <span className={s.bname}>{b.name}</span>}
              <div className={s.bact}>
                {b.id !== current && <button className="btn" onClick={() => onPick(b.id)}>Pokaż</button>}
                <button className="btn" onClick={() => onShare(b)}>👥 {shareInfo(b) || "Udostępnij"}</button>
                {mine && own.length > 1 && (
                  <button className={`btn danger ${armed === b.id ? "armed" : ""}`} onClick={() => { if (armed !== b.id) return setArmed(b.id); setArmed(""); onArchive(b); }}>
                    {armed === b.id ? "Na pewno?" : "Archiwizuj"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <form className={s.addbook} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName(""); } }}>
          <input aria-label="Nowy budżet" placeholder="Nowy budżet, np. Wakacje" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!name.trim()}>Dodaj</button>
        </form>
        <button className="btn" onClick={onClose}>Zamknij</button>
      </div>
    </div>
  );
}
