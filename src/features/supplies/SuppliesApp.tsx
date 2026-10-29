"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { insertItem, insertTab, loadSupplies, subscribe, updateItem, updateTab } from "./data";
import ItemRow from "./ItemRow";
import ItemSheet from "./ItemSheet";
import { fmtRange, fold, sum } from "./money";
import RemovedList from "./RemovedList";
import Summary from "./Summary";
import TabBar from "./TabBar";
import TabsSheet from "./TabsSheet";
import type { ItemFields, Status, SupplyItem, SupplyTab, TabFields } from "./types";
import s from "./supplies.module.css";

const SEL_KEY = "supplies-tab";
const newer = (a: { updated_at: string }, b: { updated_at: string }) => Date.parse(a.updated_at) >= Date.parse(b.updated_at);

/** Replace by id unless the local row is newer (own optimistic writes echo back through realtime) */
function merge<T extends { id: string; updated_at: string }>(list: T[], row: T): T[] {
  const cur = list.find((x) => x.id === row.id);
  if (!cur) return [...list, row];
  return newer(row, cur) ? list.map((x) => (x.id === row.id ? row : x)) : list;
}

function groupByCategory(items: SupplyItem[]): [string, SupplyItem[]][] {
  const map = new Map<string, SupplyItem[]>();
  for (const i of [...items].sort((a, b) => a.sort_order - b.sort_order)) map.set(i.category, [...(map.get(i.category) ?? []), i]);
  return [...map.entries()];
}

export default function SuppliesApp() {
  const [tabs, setTabs] = useState<SupplyTab[]>([]);
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("connecting");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Rendered only after the shell has a session, so never during prerender
  const [sel, setSel] = useState(() => { try { return sessionStorage.getItem(SEL_KEY) ?? "all"; } catch { return "all"; } });
  const [hide, setHide] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sheet, setSheet] = useState<SupplyItem | "new" | null>(null);
  const [tabsOpen, setTabsOpen] = useState(false);
  const hiddenAt = useRef(0);
  const seenLive = useRef(false);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);

  const reload = useCallback(async () => {
    try {
      const d = await loadSupplies();
      setTabs(d.tabs); setItems(d.items); setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribe(
      (t) => setTabs((l) => merge(l, t)),
      (i) => setItems((l) => merge(l, i)),
      (st) => {
        setStatus(st);
        if (st === "live") { if (seenLive.current) reload(); seenLive.current = true; }
      },
    );
    loadSupplies().then(
      (d) => { setTabs(d.tabs); setItems(d.items); setError(""); setLoaded(true); },
      (e) => { setError((e as Error).message); setLoaded(true); },
    );
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 60_000) reload();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { unsub(); document.removeEventListener("visibilitychange", onVis); clearTimeout(toastTimer.current); };
  }, [reload]);

  const activeTabs = useMemo(() => tabs.filter((t) => !t.archived).sort((a, b) => a.sort_order - b.sort_order), [tabs]);
  const cur = sel === "all" || activeTabs.some((t) => t.id === sel) ? sel : "all";
  const pick = (id: string) => {
    setSel(id); setCat("");
    try { sessionStorage.setItem(SEL_KEY, id); } catch { /* storage unavailable */ }
  };

  const live = useMemo(() => {
    const ids = new Set(activeTabs.map((t) => t.id));
    return items.filter((i) => ids.has(i.tab_id) && (cur === "all" || i.tab_id === cur));
  }, [items, activeTabs, cur]);
  const active = live.filter((i) => !i.removed);
  const categories = useMemo(() => [...new Set(groupByCategory(active).map(([c]) => c))], [active]);
  const needle = fold(q.trim());
  const shown = active.filter((i) =>
    (!hide || !i.checked) && (!cat || i.category === cat) &&
    (!needle || fold(`${i.name} ${i.details ?? ""}`).includes(needle)));

  // Optimistic write, revert and toast on error
  const patchItem = useCallback(async (id: string, patch: ItemFields) => {
    const prev = items.find((i) => i.id === id);
    setItems((l) => l.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    try {
      const row = await updateItem(id, patch);
      setItems((l) => l.map((i) => (i.id === id ? row : i)));
    } catch (e) {
      if (prev) setItems((l) => l.map((i) => (i.id === id ? prev : i)));
      flash(`Nie zapisano: ${(e as Error).message}`);
    }
  }, [items, flash]);

  const patchTab = useCallback(async (id: string, patch: TabFields) => {
    const prev = tabs.find((t) => t.id === id);
    setTabs((l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      const row = await updateTab(id, patch);
      setTabs((l) => l.map((t) => (t.id === id ? row : t)));
    } catch (e) {
      if (prev) setTabs((l) => l.map((t) => (t.id === id ? prev : t)));
      flash(`Nie zapisano: ${(e as Error).message}`);
    }
  }, [tabs, flash]);

  const endOf = (tabId: string, category: string) =>
    Math.max(0, ...items.filter((i) => i.tab_id === tabId && i.category === category).map((i) => i.sort_order)) + 1;

  async function save(item: SupplyItem | null, fields: ItemFields) {
    setSheet(null);
    if (!item) {
      try {
        const row = await insertItem({ ...fields, sort_order: endOf(fields.tab_id!, fields.category!) });
        setItems((l) => merge(l, row));
      } catch (e) { flash(`Nie zapisano: ${(e as Error).message}`); }
      return;
    }
    if (fields.tab_id || fields.category) {
      fields.sort_order = endOf(fields.tab_id ?? item.tab_id, fields.category ?? item.category);
    }
    if (Object.keys(fields).length) await patchItem(item.id, fields);
  }

  function move(item: SupplyItem, dir: -1 | 1) {
    const group = shown.filter((i) => i.tab_id === item.tab_id && i.category === item.category).sort((a, b) => a.sort_order - b.sort_order);
    const other = group[group.findIndex((i) => i.id === item.id) + dir];
    if (!other) return;
    patchItem(item.id, { sort_order: other.sort_order });
    patchItem(other.id, { sort_order: item.sort_order });
  }

  function moveTab(tab: SupplyTab, dir: -1 | 1) {
    const other = activeTabs[activeTabs.findIndex((t) => t.id === tab.id) + dir];
    if (!other) return;
    patchTab(tab.id, { sort_order: other.sort_order });
    patchTab(other.id, { sort_order: tab.sort_order });
  }

  async function addTab(name: string) {
    try {
      const row = await insertTab({ name, sort_order: Math.max(0, ...tabs.map((t) => t.sort_order)) + 1 });
      setTabs((l) => merge(l, row));
    } catch (e) { flash(`Nie zapisano: ${(e as Error).message}`); }
  }

  const catsOf = (tabId: string) => [...new Set(items.filter((i) => i.tab_id === tabId).map((i) => i.category))];

  function renderGroups(list: SupplyItem[]) {
    return groupByCategory(list).map(([c, group]) => (
      <Fragment key={c}>
        <h3 className={`label ${s.cat}`}>{c}</h3>
        <div className={s.group}>
          {group.map((i, idx) => (
            <ItemRow key={i.id} item={i} onPatch={patchItem} onOpen={setSheet} onMove={move} canUp={idx > 0} canDown={idx < group.length - 1} />
          ))}
        </div>
      </Fragment>
    ));
  }

  if (!loaded) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;

  return (
    <main className={s.page}>
      <div className={s.top}>
        <Summary items={active} status={status} />
        <TabBar tabs={activeTabs} sel={cur} onSel={pick} onManage={() => setTabsOpen(true)} />
        <div className={s.filters}>
          <label><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />Ukryj kupione</label>
          <input type="search" aria-label="Szukaj" placeholder="Szukaj…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Kategoria" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Wszystkie kategorie</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="banner"><span>{error}</span><button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
      {!error && activeTabs.length === 0 && <div className="empty"><strong>Brak podzakładek</strong>Dodaj pierwszą przez „⋯”.</div>}

      <div>
        {cur === "all"
          ? activeTabs.map((t) => {
              const mine = shown.filter((i) => i.tab_id === t.id);
              if (mine.length === 0) return null;
              const [lo, hi] = sum(active.filter((i) => i.tab_id === t.id));
              return (
                <section key={t.id} aria-label={t.name}>
                  <div className={s.tabhead}>
                    <h2>{t.name}</h2>
                    {hi > 0 && <span className="sub">razem ok. {fmtRange(lo, hi)}</span>}
                  </div>
                  {t.description && <p className="sub">{t.description}</p>}
                  {renderGroups(mine)}
                </section>
              );
            })
          : renderGroups(shown)}
        {active.length > 0 && shown.length === 0 && <p className="sub">Nic nie pasuje do filtrów.</p>}
      </div>

      <RemovedList items={live.filter((i) => i.removed)} onPatch={patchItem} />

      {activeTabs.length > 0 && <button className={`btn primary ${s.fab}`} onClick={() => setSheet("new")}>+ Dodaj</button>}
      {sheet && (
        <ItemSheet
          item={sheet === "new" ? null : sheet}
          tabs={activeTabs}
          defaultTab={cur === "all" ? activeTabs[0].id : cur}
          categories={catsOf}
          onSave={save}
          onRemove={(i) => { setSheet(null); patchItem(i.id, { removed: true }); }}
          onClose={() => setSheet(null)}
        />
      )}
      {tabsOpen && <TabsSheet tabs={tabs.slice().sort((a, b) => a.sort_order - b.sort_order)} items={items} onUpdate={patchTab} onMove={moveTab} onAdd={addTab} onClose={() => setTabsOpen(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
