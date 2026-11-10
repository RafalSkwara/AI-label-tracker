"use client";

import { useRef, useState } from "react";
import type { ShoppingItem, ShoppingList } from "./types";
import s from "./shopping.module.css";

type Props = {
  list: ShoppingList;
  items: ShoppingItem[];
  onBack: () => void;
  onRename: (name: string) => void;
  onArchive: () => void;
  onAdd: (name: string, quantity: string | null) => Promise<void>;
  onToggle: (item: ShoppingItem) => void;
  onRemove: (item: ShoppingItem) => void;
  onClearChecked: (done: ShoppingItem[]) => void;
};

function Row({ item, onToggle, onRemove }: { item: ShoppingItem; onToggle: Props["onToggle"]; onRemove: Props["onRemove"] }) {
  return (
    <li className={`${s.row} ${item.checked ? s.done : ""}`}>
      <label className={s.chk}>
        <input type="checkbox" checked={item.checked} onChange={() => onToggle(item)} aria-label={item.name} />
        <span className={s.text}>
          <span className={s.name}>{item.name}</span>
          {item.quantity && <span className={s.qty}>{item.quantity}</span>}
        </span>
      </label>
      <button className={s.icon} onClick={() => onRemove(item)} aria-label={`Usuń: ${item.name}`}>×</button>
    </li>
  );
}

export default function ListView({ list, items, onBack, onRename, onArchive, onAdd, onToggle, onRemove, onClearChecked }: Props) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const todo = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await onAdd(n, qty.trim() || null);
      setName(""); setQty("");
    } catch { /* toast already shown; keep the typed text */ }
    setBusy(false);
    nameRef.current?.focus(); // keep the keyboard open for the next item
  }

  function saveTitle(e: React.FormEvent) {
    e.preventDefault();
    const t = title?.trim();
    if (t && t !== list.name) onRename(t);
    setTitle(null);
  }

  return (
    <>
      <div className={s.head}>
        <button className={s.back} onClick={onBack}>← Listy</button>
        <button className={s.icon} aria-expanded={menu} aria-label="Opcje listy" onClick={() => setMenu((m) => !m)}>⋯</button>
      </div>

      {title !== null ? (
        <form className={s.add} onSubmit={saveTitle}>
          <input aria-label="Nazwa listy" autoFocus maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn primary" disabled={!title.trim()}>Zapisz</button>
          <button type="button" className="btn" onClick={() => setTitle(null)}>Anuluj</button>
        </form>
      ) : (
        <h1 className={s.title}>{list.name}</h1>
      )}

      {menu && (
        <div className={s.menu}>
          <button className="btn" onClick={() => { setMenu(false); setTitle(list.name); }}>Zmień nazwę</button>
          <button className="btn danger" onClick={() => { if (confirm(`Przenieść listę „${list.name}” do archiwum?`)) onArchive(); }}>Archiwizuj listę</button>
        </div>
      )}

      <form className={s.add} onSubmit={add}>
        <input ref={nameRef} aria-label="Produkt" placeholder="Produkt" maxLength={200} enterKeyHint="done" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={s.qtyin} aria-label="Ilość" placeholder="Ilość" maxLength={40} value={qty} onChange={(e) => setQty(e.target.value)} />
        <button className="btn primary" disabled={!name.trim() || busy}>Dodaj</button>
      </form>

      {items.length === 0 && <div className="empty"><strong>Lista jest pusta</strong>Dodaj pierwszy produkt powyżej.</div>}
      {items.length > 0 && todo.length === 0 && <p className="sub">Wszystko kupione.</p>}

      <ul className={s.items} aria-label="Do kupienia">
        {todo.map((i) => <Row key={i.id} item={i} onToggle={onToggle} onRemove={onRemove} />)}
      </ul>

      {done.length > 0 && (
        <section aria-label="Kupione">
          <div className={s.donehead}>
            <h2>Kupione ({done.length})</h2>
            <button className="linkbtn" onClick={() => onClearChecked(done)}>Usuń kupione</button>
          </div>
          <ul className={s.items}>
            {done.map((i) => <Row key={i.id} item={i} onToggle={onToggle} onRemove={onRemove} />)}
          </ul>
        </section>
      )}
    </>
  );
}
