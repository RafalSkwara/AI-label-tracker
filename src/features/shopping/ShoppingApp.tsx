"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { archiveItems, archiveList, insertItem, insertList, loadShopping, renameList, setChecked } from "./data";
import ListView from "./ListView";
import type { ShoppingItem, ShoppingList } from "./types";
import s from "./shopping.module.css";

export type Toast = { msg: string; undo?: () => void };

const PARAM = "lista";
const fromUrl = () => new URLSearchParams(window.location.search).get(PARAM);

/** Shopping lists: overview of the user's lists, or one list when ?lista=<id> is in the URL (the phone's back button returns to the overview) */
export default function ShoppingApp() {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  // Rendered only after the shell has a session, so never during prerender
  const [sel, setSel] = useState<string | null>(fromUrl);
  const [name, setName] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((t: Toast) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), t.undo ? 6000 : 3200);
  }, []);
  const fail = useCallback((e: unknown) => flash({ msg: `Nie zapisano: ${(e as Error).message}` }), [flash]);

  const reload = useCallback(async () => {
    try {
      const d = await loadShopping();
      setLists(d.lists); setItems(d.items); setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // initial load: setState happens after the awaited fetch, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const onPop = () => setSel(fromUrl());
    // another device may have changed the lists while the app was in the background
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("popstate", onPop);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("visibilitychange", onVis); };
  }, [reload]);

  function open(id: string | null) {
    const u = new URL(window.location.href);
    if (id) {
      u.searchParams.set(PARAM, id);
      history.pushState({ shoppingList: true }, "", u);
    } else if (history.state?.shoppingList) {
      history.back(); // opened from the overview: go back so the phone's back button does not return here
    } else {
      u.searchParams.delete(PARAM);
      history.replaceState(null, "", u);
    }
    setSel(id);
  }

  const replaceItems = (rows: ShoppingItem[]) => setItems((l) => l.map((x) => rows.find((r) => r.id === x.id) ?? x));

  async function addList(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      const l = await insertList(n);
      setLists((ls) => [...ls, l]);
      setName("");
      open(l.id);
    } catch (err) { fail(err); }
  }

  async function rename(id: string, n: string) {
    const prev = lists;
    setLists((ls) => ls.map((l) => (l.id === id ? { ...l, name: n } : l)));
    try { const l = await renameList(id, n); setLists((ls) => ls.map((x) => (x.id === id ? l : x))); }
    catch (err) { setLists(prev); fail(err); }
  }

  async function removeList(id: string) {
    try {
      await archiveList(id);
      setLists((ls) => ls.filter((l) => l.id !== id));
      open(null);
      flash({ msg: "Lista przeniesiona do archiwum" });
    } catch (err) { fail(err); }
  }

  async function addItem(listId: string, n: string, qty: string | null) {
    try { const i = await insertItem(listId, n, qty); setItems((l) => [...l, i]); }
    catch (err) { fail(err); throw err; }
  }

  async function toggle(item: ShoppingItem) {
    const checked = !item.checked;
    setItems((l) => l.map((x) => (x.id === item.id ? { ...x, checked } : x)));
    try { replaceItems([await setChecked(item.id, checked)]); }
    catch (err) { setItems((l) => l.map((x) => (x.id === item.id ? { ...x, checked: !checked } : x))); fail(err); }
  }

  async function remove(gone: ShoppingItem[], msg: string) {
    if (gone.length === 0) return;
    const ids = gone.map((i) => i.id);
    setItems((l) => l.filter((x) => !ids.includes(x.id)));
    try {
      await archiveItems(ids);
      flash({
        msg,
        undo: async () => {
          setToast(null);
          try { const back = await archiveItems(ids, false); setItems((l) => [...l, ...back].sort((a, b) => a.created_at.localeCompare(b.created_at))); }
          catch (err) { fail(err); }
        },
      });
    } catch (err) { setItems((l) => [...l, ...gone].sort((a, b) => a.created_at.localeCompare(b.created_at))); fail(err); }
  }

  if (!loaded) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;

  const list = sel ? lists.find((l) => l.id === sel) : undefined;

  return (
    <main className={s.page}>
      {error && <div className="banner"><span>{error}</span><button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}

      {list ? (
        <ListView
          list={list}
          items={items.filter((i) => i.list_id === list.id)}
          onBack={() => open(null)}
          onRename={(n) => rename(list.id, n)}
          onArchive={() => removeList(list.id)}
          onAdd={(n, q) => addItem(list.id, n, q)}
          onToggle={toggle}
          onRemove={(i) => remove([i], `Usunięto: ${i.name}`)}
          onClearChecked={(done) => remove(done, `Usunięto kupione (${done.length})`)}
        />
      ) : (
        <>
          <h1>Listy zakupów</h1>
          {sel && !error && <p className="sub">Tej listy już nie ma.</p>}
          <form className={s.add} onSubmit={addList}>
            <input aria-label="Nazwa nowej listy" placeholder="Nowa lista, np. Biedronka" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" disabled={!name.trim()}>Utwórz</button>
          </form>
          {lists.length === 0 && !error && <div className="empty"><strong>Brak list</strong>Utwórz pierwszą listę powyżej.</div>}
          <div className={s.lists}>
            {lists.map((l) => {
              const mine = items.filter((i) => i.list_id === l.id);
              const left = mine.filter((i) => !i.checked).length;
              return (
                <button key={l.id} className={s.listcard} onClick={() => open(l.id)}>
                  <span className={s.lname}>{l.name}</span>
                  <span className="sub">{mine.length === 0 ? "pusta" : left === 0 ? `wszystko kupione (${mine.length})` : `do kupienia: ${left} z ${mine.length}`}</span>
                </button>
              );
            })}
          </div>
        </>
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
