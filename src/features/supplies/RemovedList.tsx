import type { ItemFields, SupplyItem } from "./types";
import s from "./supplies.module.css";

export default function RemovedList({ items, onPatch }: { items: SupplyItem[]; onPatch: (id: string, patch: ItemFields) => void }) {
  if (items.length === 0) return null;
  return (
    <section className={s.removed} aria-label="Usunięte z listy">
      <h2 className="label">Usunięte z listy ({items.length})</h2>
      {items.map((i) => (
        <div key={i.id} className={s.row}>
          <span className={s.main}><span className={s.name}>{i.name}</span>{i.quantity && <span className={s.qty}>{i.quantity}</span>}</span>
          <span className={s.act}><button className={s.icon} onClick={() => onPatch(i.id, { removed: false })} aria-label={`Przywróć: ${i.name}`}>↺</button></span>
        </div>
      ))}
    </section>
  );
}
