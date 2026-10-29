import { useState, type FormEvent } from "react";
import type { ItemFields, SupplyItem, SupplyTab } from "./types";

type Props = {
  item: SupplyItem | null;
  tabs: SupplyTab[];
  defaultTab: string;
  categories: (tabId: string) => string[];
  onSave: (item: SupplyItem | null, fields: ItemFields) => void;
  onRemove: (item: SupplyItem) => void;
  onClose: () => void;
};

const num = (v: string): number | null | "bad" => {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};
const str = (v: string) => v.trim() || null;

export default function ItemSheet({ item, tabs, defaultTab, categories, onSave, onRemove, onClose }: Props) {
  const [f, setF] = useState({
    name: item?.name ?? "",
    tab_id: item?.tab_id ?? defaultTab,
    category: item?.category ?? "",
    quantity: item?.quantity ?? "",
    details: item?.details ?? "",
    from: item?.price_min?.toString() ?? "",
    to: item?.price_max?.toString() ?? "",
    label: item?.price_label ?? "",
    own: item?.own_price?.toString() ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    const min = num(f.from), max = num(f.to), own = num(f.own);
    if (!f.name.trim()) return setError("Podaj nazwę.");
    if (min === "bad" || max === "bad" || own === "bad") return setError("Cena musi być liczbą od 0.");
    if (max !== null && min === null) return setError("Podaj cenę „Od”.");
    if (max !== null && min !== null && max < min) return setError("„Do” nie może być mniejsze niż „Od”.");
    const all: ItemFields = {
      name: f.name.trim(), tab_id: f.tab_id, category: f.category.trim() || "Inne", quantity: str(f.quantity), details: str(f.details),
      price_min: min, price_max: max, price_label: str(f.label), own_price: own,
    };
    // Only changed columns go to the database (last write wins per field)
    const fields = item
      ? (Object.fromEntries(Object.entries(all).filter(([k, v]) => item[k as keyof SupplyItem] !== v)) as ItemFields)
      : all;
    onSave(item, fields);
  }

  const cats = categories(f.tab_id);
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label={item ? "Edytuj pozycję" : "Nowa pozycja"}>
        <strong>{item ? "Edytuj pozycję" : "Nowa pozycja"}</strong>
        <form onSubmit={submit}>
          <label className="field wide">Nazwa *<input value={f.name} onChange={set("name")} autoFocus={!item} /></label>
          <label className="field">Podzakładka
            <select value={f.tab_id} onChange={set("tab_id")}>{tabs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label className="field">Kategoria
            <input list="supply-cats" value={f.category} onChange={set("category")} placeholder="Inne" />
            <datalist id="supply-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="field wide">Ilość<input value={f.quantity} onChange={set("quantity")} /></label>
          <label className="field wide">Szczegóły<textarea value={f.details} onChange={set("details")} /></label>
          <label className="field">Cena od (zł)<input inputMode="decimal" value={f.from} onChange={set("from")} /></label>
          <label className="field">Cena do (zł)<input inputMode="decimal" value={f.to} onChange={set("to")} /></label>
          <label className="field">Opis ceny<input value={f.label} onChange={set("label")} /></label>
          <label className="field">Twoja cena (zł)<input inputMode="decimal" value={f.own} onChange={set("own")} /></label>
          {error && <p className="wide" style={{ color: "var(--bad)", margin: 0 }}>{error}</p>}
          <div className="actions">
            {item ? <button type="button" className="btn danger" onClick={() => onRemove(item)}>Usuń z listy</button> : <span />}
            <div>
              <button type="button" className="btn" onClick={onClose}>Anuluj</button>
              <button type="submit" className="btn primary">Zapisz</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
