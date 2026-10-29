import { useState } from "react";
import { effective, fmtRange } from "./money";
import type { ItemFields, SupplyItem } from "./types";
import s from "./supplies.module.css";

type Props = {
  item: SupplyItem;
  onPatch: (id: string, patch: ItemFields) => void;
  onOpen: (item: SupplyItem) => void;
  onMove: (item: SupplyItem, dir: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
};

function PriceButton({ item, onPatch }: Pick<Props, "item" | "onPatch">) {
  const [draft, setDraft] = useState<string | null>(null);
  const e = effective(item);

  if (draft !== null) {
    const save = () => {
      const t = draft.trim().replace(",", ".");
      const v = t === "" ? null : Number(t);
      setDraft(null);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return;
      if (v !== item.own_price) onPatch(item.id, { own_price: v });
    };
    return (
      <input
        className={s.priceinput}
        autoFocus
        inputMode="decimal"
        aria-label="Twoja cena"
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={save}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") ev.currentTarget.blur();
          if (ev.key === "Escape") setDraft(null);
        }}
      />
    );
  }
  const cls = `${s.price} ${e?.own ? s.own : ""} ${e ? "" : s.none}`;
  return (
    <>
      <button className={cls} onClick={() => setDraft(item.own_price != null ? String(item.own_price) : "")}>
        {e ? fmtRange(e.min, e.max) : item.price_label ?? "dodaj cenę"}
      </button>
      {e?.own && <span className={s.own}>Twoja cena</span>}
    </>
  );
}

export default function ItemRow({ item, onPatch, onOpen, onMove, canUp, canDown }: Props) {
  return (
    <div className={`${s.row} ${item.checked ? s.done : ""}`}>
      <label className={s.chk}>
        <input type="checkbox" checked={item.checked} onChange={(e) => onPatch(item.id, { checked: e.target.checked })} aria-label={`Kupione: ${item.name}`} />
        {item.checked && <span className={s.badge}>{item.checked_initial ?? "✓"}</span>}
      </label>
      <button className={s.main} onClick={() => onOpen(item)}>
        <span className={s.name}>{item.name}</span>
        {item.quantity && <span className={s.qty}>{item.quantity}</span>}
        {item.details && <span className={s.det}>{item.details}</span>}
      </button>
      <div className={s.act}>
        <PriceButton item={item} onPatch={onPatch} />
        <span className={s.sp} />
        <button className={s.icon} disabled={!canUp} onClick={() => onMove(item, -1)} aria-label="Wyżej">↑</button>
        <button className={s.icon} disabled={!canDown} onClick={() => onMove(item, 1)} aria-label="Niżej">↓</button>
        <button className={s.icon} onClick={() => onPatch(item.id, { removed: true })} aria-label={`Usuń z listy: ${item.name}`}>×</button>
      </div>
    </div>
  );
}
