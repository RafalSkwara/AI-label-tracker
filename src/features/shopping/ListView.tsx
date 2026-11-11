"use client";

import { useCallback, useRef, useState } from "react";
import { displayName, type Product, productUrl, SOURCES } from "@/lib/off";
import { lookupBarcode } from "./data";
import { fmtPrice, parsePrice, sumPrices } from "./money";
import Scanner from "./Scanner";
import type { ShoppingItem, ShoppingList } from "./types";
import s from "./shopping.module.css";

type Patch = Partial<Pick<ShoppingItem, "name" | "quantity" | "price" | "checked">>;

type Props = {
  list: ShoppingList;
  items: ShoppingItem[];
  history: string[];
  onBack: () => void;
  onRename: (name: string) => void;
  onArchive: () => void;
  /** send the open items as text (system share sheet or clipboard) */
  onSendText: () => void;
  /** the caller owns the list (only the owner renames, archives and shares) */
  owner: boolean;
  /** "Udostępniona 2 osobom" / "od x@y.pl" / "" */
  shareInfo: string;
  onSharing: () => void;
  onAdd: (name: string, quantity: string | null, barcode: string | null) => Promise<void>;
  flash: (msg: string) => void;
  onPatch: (item: ShoppingItem, patch: Patch) => void;
  onRemove: (item: ShoppingItem) => void;
  onClearChecked: (done: ShoppingItem[]) => void;
  onUncheckAll: (done: ShoppingItem[]) => void;
};

/** Inline editor for a product's name and quantity */
function EditRow({ item, onSave, onClose }: { item: ShoppingItem; onSave: (p: Patch) => void; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(item.quantity ?? "");
  const [price, setPrice] = useState(item.price != null ? String(item.price).replace(".", ",") : "");
  const pr = parsePrice(price);
  function save(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim(), q = qty.trim() || null;
    if (!n || pr === undefined) return;
    const patch: Patch = {};
    if (n !== item.name) patch.name = n;
    if (q !== item.quantity) patch.quantity = q;
    if (pr !== item.price) patch.price = pr;
    if (Object.keys(patch).length) onSave(patch);
    onClose();
  }
  return (
    <li className={s.editrow}>
      <form className={s.editform} onSubmit={save} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <input className={s.full} aria-label="Nazwa produktu" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Ilość produktu" placeholder="Ilość" autoFocus maxLength={40} value={qty} onChange={(e) => setQty(e.target.value)} />
        <input aria-label="Cena" placeholder="Cena, zł" inputMode="decimal" aria-invalid={pr === undefined} value={price} onChange={(e) => setPrice(e.target.value)} />
        <button hidden />
      </form>
      {pr === undefined && <p className={s.err}>Cena to liczba, np. 4,99.</p>}
      {item.barcode && (
        <p className={s.code}>
          Kod {item.barcode} · <a href={productUrl("off", item.barcode)} target="_blank" rel="noopener noreferrer">Open Food Facts ↗</a>
        </p>
      )}
      <div className={s.editact}>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!name.trim() || pr === undefined} onClick={save}>Zapisz</button>
      </div>
    </li>
  );
}

function Row({ item, onPatch, onRemove, onEdit }: { item: ShoppingItem; onPatch: Props["onPatch"]; onRemove: Props["onRemove"]; onEdit: () => void }) {
  return (
    <li className={`${s.row} ${item.checked ? s.done : ""}`}>
      <label className={s.chk}>
        <input type="checkbox" checked={item.checked} onChange={() => onPatch(item, { checked: !item.checked })} aria-label={item.name} />
      </label>
      <button className={s.text} onClick={onEdit} aria-label={`Edytuj: ${item.name}`}>
        <span className={s.name}>{item.name}</span>
        {item.quantity ? <span className={s.qty}>{item.quantity}</span> : !item.checked && <span className={s.qtyadd}>+ ilość, cena</span>}
      </button>
      {item.price != null && <span className={s.price}>{fmtPrice(item.price)}</span>}
      <button className={s.icon} onClick={() => onRemove(item)} aria-label={`Usuń: ${item.name}`}>×</button>
    </li>
  );
}

export default function ListView(p: Props) {
  const { list, items, history } = p;
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [found, setFound] = useState<{ barcode: string; source: Product["source"] | null } | null>(null);
  const [looking, setLooking] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const { flash } = p;

  const onCode = useCallback(async (code: string) => {
    setScan(false);
    setLooking(true);
    try {
      const prod = await lookupBarcode(code);
      setFound({ barcode: code, source: prod?.source ?? null });
      if (prod) {
        setName(displayName(prod));
        if (prod.quantity) setQty(prod.quantity);
        setTimeout(() => addRef.current?.focus(), 0);
      } else {
        flash("Nie znam tego kodu. Wpisz nazwę, zapamiętam ją.");
        setTimeout(() => nameRef.current?.focus(), 0);
      }
    } catch (e) {
      setFound({ barcode: code, source: null });
      flash(`Nie udało się sprawdzić kodu: ${(e as Error).message}`);
    }
    setLooking(false);
  }, [flash]);

  const todo = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const onList = new Set(todo.map((i) => i.name.trim().toLocaleLowerCase("pl")));
  const suggestions = history.filter((h) => !onList.has(h.toLocaleLowerCase("pl"))).slice(0, 200);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await p.onAdd(n, qty.trim() || null, found?.barcode ?? null);
      setName(""); setQty(""); setFound(null);
    } catch { /* toast already shown; keep the typed text */ }
    setBusy(false);
    nameRef.current?.focus(); // keep the keyboard open for the next item
  }

  function saveTitle(e: React.FormEvent) {
    e.preventDefault();
    const t = title?.trim();
    if (t && t !== list.name) p.onRename(t);
    setTitle(null);
  }

  const row = (i: ShoppingItem) => editing === i.id
    ? <EditRow key={i.id} item={i} onSave={(patch) => p.onPatch(i, patch)} onClose={() => setEditing(null)} />
    : <Row key={i.id} item={i} onPatch={p.onPatch} onRemove={p.onRemove} onEdit={() => setEditing(i.id)} />;

  return (
    <>
      <div className={s.head}>
        <button className={s.back} onClick={p.onBack}>← Listy</button>
        <button className={s.icon} aria-expanded={menu} aria-label="Opcje listy" onClick={() => setMenu((m) => !m)}>⋯</button>
      </div>

      {title !== null ? (
        <form className={s.add} onSubmit={saveTitle} onKeyDown={(e) => { if (e.key === "Escape") setTitle(null); }}>
          <input aria-label="Nazwa listy" autoFocus maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn primary" disabled={!title.trim()}>Zapisz</button>
          <button type="button" className="btn" onClick={() => setTitle(null)}>Anuluj</button>
        </form>
      ) : (
        <div className={s.titlerow}>
          {p.owner ? (
            <button className={s.titlebtn} onClick={() => setTitle(list.name)} aria-label={`Zmień nazwę listy: ${list.name}`}>
              <h1 className={s.title}>{list.name}</h1>
              <span className={s.pen} aria-hidden="true">✎</span>
            </button>
          ) : <h1 className={s.title}>{list.name}</h1>}
          <button className={s.sharedbtn} onClick={p.onSharing}>👥 {p.shareInfo || "Tylko Ty · udostępnij"}</button>
          {items.length > 0 && (
            <span className="sub">
              {todo.length === 0 ? "wszystko kupione" : `do kupienia: ${todo.length}`}
              {sumPrices(todo) > 0 && ` · ok. ${fmtPrice(sumPrices(todo))}`}
              {sumPrices(done) > 0 && ` · w koszyku: ${fmtPrice(sumPrices(done))}`}
            </span>
          )}
        </div>
      )}

      {menu && (
        <div className={s.menu}>
          <button className="btn" onClick={() => { setMenu(false); p.onSharing(); }}>{p.owner ? "Udostępnij osobom" : "Kto ma dostęp"}</button>
          <button className="btn" onClick={() => { setMenu(false); p.onSendText(); }} disabled={todo.length === 0}>Wyślij jako tekst</button>
          {p.owner && <button className="btn" onClick={() => { setMenu(false); setTitle(list.name); }}>Zmień nazwę</button>}
          <button className="btn" disabled={done.length === 0} onClick={() => { setMenu(false); p.onClearChecked(done); }}>Usuń kupione</button>
          {p.owner && <button className="btn danger" onClick={() => { if (confirm(`Przenieść listę „${list.name}” do archiwum?`)) p.onArchive(); }}>Archiwizuj listę</button>}
        </div>
      )}

      <form className={s.add} onSubmit={add}>
        <input ref={nameRef} aria-label="Produkt" placeholder="Produkt" maxLength={200} enterKeyHint="done" autoComplete="off" list="shopping-history" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={s.qtyin} aria-label="Ilość" placeholder="Ilość" maxLength={40} value={qty} onChange={(e) => setQty(e.target.value)} />
        <button type="button" className={s.icon} onClick={() => setScan(true)} disabled={looking} aria-label="Skanuj kod kreskowy">{looking ? "…" : "📷"}</button>
        <button ref={addRef} className="btn primary" disabled={!name.trim() || busy}>Dodaj</button>
      </form>
      {found && (
        <p className={s.code}>
          Kod {found.barcode}{found.source && found.source !== "own" ? ` · ${SOURCES.find((x) => x.id === found.source)!.label}` : found.source === "own" ? " · z Twojej historii" : " · nieznany"}
          <button type="button" className="linkbtn" onClick={() => setFound(null)}>usuń kod</button>
        </p>
      )}
      {scan && <Scanner onCode={onCode} onClose={() => setScan(false)} />}
      <datalist id="shopping-history">{suggestions.map((h) => <option key={h} value={h} />)}</datalist>

      {items.length === 0 && <div className="empty"><strong>Lista jest pusta</strong>Dodaj pierwszy produkt powyżej. Dotknij produktu, żeby zmienić nazwę lub ilość.</div>}

      <ul className={s.items} aria-label="Do kupienia">{todo.map(row)}</ul>

      {done.length > 0 && (
        <section aria-label="Kupione">
          <div className={s.donehead}>
            <h2>Kupione ({done.length})</h2>
          </div>
          <div className={s.doneact}>
            <button className="btn" onClick={() => p.onUncheckAll(done)}>↺ Odznacz wszystkie</button>
            <button className="btn danger" onClick={() => p.onClearChecked(done)}>🗑 Usuń kupione ({done.length})</button>
          </div>
          <ul className={s.items}>{done.map(row)}</ul>
        </section>
      )}
    </>
  );
}
