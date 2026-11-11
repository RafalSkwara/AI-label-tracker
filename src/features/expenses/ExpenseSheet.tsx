"use client";

import { useMemo, useState } from "react";
import { fmtPrice, parsePrice } from "@/features/shopping/money";
import type { ShoppingItem, ShoppingList } from "@/features/shopping/types";
import { CATEGORIES, type Category, matchItems, type ReceiptItem, type ReceiptRead } from "@/lib/receipt";
import { type Book, type Expense, type ExpenseFields, photoUrl } from "./data";
import s from "./expenses.module.css";

/** List item to tick off with the price from the receipt */
export type Tick = { itemId: string; price: number | null };

type Props = {
  expense: Expense | null;
  /** new expense: what the AI read (null = typed in by hand) */
  read: ReceiptRead | null;
  /** new expense with a photo: preview while it is being read */
  preview: string | null;
  reading: boolean;
  readError: string;
  today: string;
  books: Book[];
  bookId: string;
  lists: ShoppingList[];
  listItems: ShoppingItem[];
  onSave: (fields: ExpenseFields, ticks: Tick[]) => void;
  onRemove: (e: Expense) => void;
  onClose: () => void;
};

/** Add (from a receipt photo or by hand) or edit one expense */
export default function ExpenseSheet(p: Props) {
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className={`sheet ${s.sheet}`} role="dialog" aria-label={p.expense ? "Edytuj wydatek" : "Nowy wydatek"}>
        <strong>{p.expense ? "Edytuj wydatek" : "Nowy wydatek"}</strong>
        {p.reading ? (
          <div className={s.reading} role="status">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL preview */}
            {p.preview && <img className={s.thumb} src={p.preview} alt="Zdjęcie paragonu" />}
            <p>Czytam paragon… zwykle 5–20 s.</p>
            <button className="btn" onClick={p.onClose}>Anuluj</button>
          </div>
        ) : <Form {...p} />}
      </div>
    </div>
  );
}

type Line = { name: string; quantity: string | null; price: string };
const toLine = (i: ReceiptItem): Line => ({ name: i.name, quantity: i.quantity, price: i.price == null ? "" : String(i.price).replace(".", ",") });

function Form({ expense, read, preview, readError, today, books, bookId, lists, listItems, onSave, onRemove, onClose }: Props) {
  const src = expense ?? read;
  const [shop, setShop] = useState(src?.shop ?? "");
  const [date, setDate] = useState((expense ? expense.spent_on : read?.date) ?? today);
  const [total, setTotal] = useState(() => {
    const t = expense ? expense.total : read?.total ?? (read?.items.length ? read.items.reduce((a, i) => a + (i.price ?? 0), 0) : null);
    return t == null ? "" : String(Math.round(t * 100) / 100).replace(".", ",");
  });
  const [category, setCategory] = useState<Category>(src?.category ?? "spozywcze");
  const [book, setBook] = useState(expense?.book_id ?? bookId);
  const [note, setNote] = useState(expense?.note ?? "");
  const [lines, setLines] = useState<Line[]>(() => (src?.items ?? []).map(toLine));
  const [showLines, setShowLines] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);

  const items: ReceiptItem[] = useMemo(
    () => lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), quantity: l.quantity, price: parsePrice(l.price) ?? null })),
    [lines],
  );
  const open = useMemo(() => listItems.filter((i) => !i.checked), [listItems]);
  // new receipt: suggest the list with the most matching unchecked items
  const [listId, setListId] = useState<string>(() => {
    if (expense) return expense.list_id ?? "";
    if (!read?.items.length) return "";
    let best = "", most = 0;
    for (const l of lists) {
      const n = matchItems(open.filter((i) => i.list_id === l.id), read.items).length;
      if (n > most) { most = n; best = l.id; }
    }
    return best;
  });
  const matches = useMemo(
    () => (expense || !listId ? [] : matchItems(open.filter((i) => i.list_id === listId), items)),
    [expense, listId, open, items],
  );
  const [skip, setSkip] = useState<Set<string>>(new Set());

  const sum = items.reduce((a, i) => a + (i.price ?? 0), 0);
  const totalNum = parsePrice(total);
  const mismatch = items.some((i) => i.price != null) && typeof totalNum === "number" && Math.abs(sum - totalNum) > 0.05;

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (typeof totalNum !== "number") return setError("Podaj kwotę, np. 42,50.");
    if (!date) return setError("Podaj datę.");
    onSave(
      { book_id: book, spent_on: date, shop: shop.trim() || null, total: totalNum, category, note: note.trim() || null, items, list_id: listId || null, photo_path: expense?.photo_path ?? null },
      matches.filter((m) => !skip.has(m.item.id)).map((m) => ({ itemId: m.item.id, price: items[m.line].price })),
    );
  }

  const patchLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form onSubmit={save}>
      {readError && <p className={`wide ${s.warn}`} role="alert">Nie udało się odczytać paragonu ({readError}). Uzupełnij ręcznie.</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL preview */}
      {preview && <img className={`wide ${s.thumb}`} src={preview} alt="Zdjęcie paragonu" />}
      {expense?.photo_path && (
        <button type="button" className="btn wide" onClick={async () => {
          const w = window.open("", "_blank");
          try { const url = await photoUrl(expense.photo_path!); if (w) w.location.href = url; } catch (err) { w?.close(); setError((err as Error).message); }
        }}>🧾 Zobacz zdjęcie paragonu</button>
      )}
      <label className="field">Kwota (zł)<input inputMode="decimal" autoFocus={!src} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0,00" /></label>
      <label className="field">Data<input type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="field">Sklep<input maxLength={80} value={shop} onChange={(e) => setShop(e.target.value)} placeholder="np. Biedronka" /></label>
      <label className="field">Kategoria
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {(Object.keys(CATEGORIES) as Category[]).map((c) => <option key={c} value={c}>{CATEGORIES[c]}</option>)}
        </select>
      </label>
      {books.length > 1 && (
        <label className="field wide">Budżet
          <select value={book} onChange={(e) => setBook(e.target.value)}>
            {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}

      <div className={`wide ${s.lines}`}>
        <button type="button" className={s.linesHead} aria-expanded={showLines} onClick={() => setShowLines((v) => !v)}>
          <span>Pozycje ({lines.length}){items.length > 0 && ` · ${fmtPrice(sum)}`}</span><span aria-hidden>{showLines ? "▴" : "▾"}</span>
        </button>
        {mismatch && <p className={s.warn}>Suma pozycji ({fmtPrice(sum)}) różni się od kwoty. Sprawdź z paragonem.</p>}
        {showLines && <>
          {lines.map((l, i) => (
            <div key={i} className={s.line}>
              <input aria-label="Nazwa" value={l.name} maxLength={120} onChange={(e) => patchLine(i, { name: e.target.value })} />
              <input aria-label="Cena" inputMode="decimal" value={l.price} onChange={(e) => patchLine(i, { price: e.target.value })} placeholder="zł" />
              <button type="button" className="btn" aria-label={`Usuń pozycję ${l.name}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { name: "", quantity: null, price: "" }])}>+ Pozycja</button>
        </>}
      </div>

      {(lists.length > 0 || expense?.list_id) && (
        <label className="field wide">Lista zakupów
          <select value={listId} onChange={(e) => { setListId(e.target.value); setSkip(new Set()); }}>
            <option value="">— bez listy —</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      {matches.length > 0 && (
        <fieldset className={`wide ${s.ticks}`}>
          <legend>Odhacz na liście i wpisz cenę</legend>
          {matches.map((m) => (
            <label key={m.item.id} className="field check">
              <input type="checkbox" checked={!skip.has(m.item.id)} onChange={() => setSkip((x) => { const n = new Set(x); if (n.has(m.item.id)) n.delete(m.item.id); else n.add(m.item.id); return n; })} />
              <span>{m.item.name} <span className="sub">← {items[m.line].name}{items[m.line].price != null && ` · ${fmtPrice(items[m.line].price!)}`}</span></span>
            </label>
          ))}
        </fieldset>
      )}

      <label className="field wide">Notatka<textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <p className={`wide ${s.err}`} role="alert">{error}</p>}
      <div className="actions">
        {expense ? (
          <button type="button" className={`btn danger ${armed ? "armed" : ""}`} onClick={() => { if (!armed) return setArmed(true); onRemove(expense); }}>
            {armed ? "Na pewno?" : "Usuń"}
          </button>
        ) : <span />}
        <div>
          <button type="button" className="btn" onClick={onClose}>Anuluj</button>
          <button className="btn primary">Zapisz</button>
        </div>
      </div>
    </form>
  );
}
