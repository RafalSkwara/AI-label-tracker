"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { archiveItems, archiveList, insertItem, insertList, loadHistory, loadShopping, renameList, uncheckItems, updateItem } from "./data";
import { addShare, loadShares, removeShare, SHOPPING, type Shares, sharedLabel } from "@/features/sharing/data";
import ShareSheet from "@/features/sharing/ShareSheet";
import ListView from "./ListView";
import type { ShoppingItem, ShoppingList } from "./types";
import s from "./shopping.module.css";

export type Toast = { msg: string; undo?: () => void };

const PARAM = "lista";
const norm = (s: string) => s.trim().toLocaleLowerCase("pl");
const byCreated = (a: ShoppingItem, b: ShoppingItem) => a.created_at.localeCompare(b.created_at);
const fromUrl = () => new URLSearchParams(window.location.search).get(PARAM);

/** Shopping lists: overview of the user's own and shared lists, or one list when ?lista=<id> is in the URL (the phone's back button returns to the overview) */
export default function ShoppingApp({ userId, email }: { userId: string; email: string }) {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  // Rendered only after the shell has a session, so never during prerender
  const [sel, setSel] = useState<string | null>(fromUrl);
  const [name, setName] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [pastNames, setPastNames] = useState<string[]>([]);
  const [shares, setShares] = useState<Shares>({});
  const [sharing, setSharing] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((t: Toast) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), t.undo ? 6000 : 3200);
  }, []);
  const fail = useCallback((e: unknown) => flash({ msg: `Nie zapisano: ${(e as Error).message}` }), [flash]);

  const reload = useCallback(async () => {
    try {
      const [d, sh] = await Promise.all([loadShopping(), loadShares(SHOPPING)]);
      setLists(d.lists); setItems(d.items); setShares(sh); setError("");
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
    loadHistory().then(setPastNames, () => {}); // suggestions are optional
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

  /** Same product already on the list: bring it back / update its quantity instead of adding a duplicate */
  async function addItem(listId: string, n: string, qty: string | null, barcode: string | null) {
    const dup = items.find((i) => i.list_id === listId && (norm(i.name) === norm(n) || (!!barcode && i.barcode === barcode)));
    try {
      if (dup) {
        const patch = { checked: false, ...(qty && qty !== dup.quantity ? { quantity: qty } : {}) };
        if (!dup.checked && !patch.quantity) { flash({ msg: `„${dup.name}” już jest na liście` }); return; }
        replaceItems([await updateItem(dup.id, patch)]);
        flash({ msg: dup.checked ? `„${dup.name}” znów do kupienia` : `Zmieniono ilość: ${dup.name}` });
        return;
      }
      const i = await insertItem(listId, n, qty, barcode);
      setItems((l) => [...l, i]);
      setPastNames((h) => (h.some((x) => norm(x) === norm(n)) ? h : [n, ...h]));
    } catch (err) { fail(err); throw err; }
  }

  async function patchItem(item: ShoppingItem, patch: Partial<Pick<ShoppingItem, "name" | "quantity" | "price" | "checked">>) {
    setItems((l) => l.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
    try { replaceItems([await updateItem(item.id, patch)]); }
    catch (err) { setItems((l) => l.map((x) => (x.id === item.id ? item : x))); fail(err); }
  }

  async function uncheckAll(done: ShoppingItem[]) {
    const ids = done.map((i) => i.id);
    setItems((l) => l.map((x) => (ids.includes(x.id) ? { ...x, checked: false } : x)));
    try { replaceItems(await uncheckItems(ids)); flash({ msg: `Znów do kupienia: ${ids.length}` }); }
    catch (err) { setItems((l) => l.map((x) => done.find((d) => d.id === x.id) ?? x)); fail(err); }
  }

  async function shareAdd(list: ShoppingList, mail: string) {
    await addShare(SHOPPING, list.id, mail);
    setShares((sh) => ({ ...sh, [list.id]: [...(sh[list.id] ?? []), mail] }));
    flash({ msg: `Udostępniono: ${mail}` });
  }
  async function shareRemove(list: ShoppingList, mail: string) {
    await removeShare(SHOPPING, list.id, mail);
    setShares((sh) => ({ ...sh, [list.id]: (sh[list.id] ?? []).filter((m) => m !== mail) }));
  }
  async function leave(list: ShoppingList) {
    await removeShare(SHOPPING, list.id, email);
    setSharing(null);
    setLists((ls) => ls.filter((l) => l.id !== list.id));
    open(null);
    flash({ msg: `Opuszczono listę „${list.name}”` });
  }

  /** Recipient: whose list; owner: how many people see it */
  const shareInfo = (l: ShoppingList) => l.owner_id !== userId
    ? `od ${l.owner_email ?? "innej osoby"}`
    : (shares[l.id]?.length ? sharedLabel(shares[l.id].length) : "");

  async function sendText(list: ShoppingList) {
    const todo = items.filter((i) => i.list_id === list.id && !i.checked);
    const text = [list.name, ...todo.map((i) => `- ${i.name}${i.quantity ? ` (${i.quantity})` : ""}`)].join("\n");
    try {
      if (navigator.share) { await navigator.share({ title: list.name, text }); return; }
      await navigator.clipboard.writeText(text);
      flash({ msg: "Skopiowano listę" });
    } catch (err) {
      if ((err as Error).name !== "AbortError") flash({ msg: "Nie udało się udostępnić listy" });
    }
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
          try { const back = await archiveItems(ids, false); setItems((l) => [...l, ...back].sort(byCreated)); }
          catch (err) { fail(err); }
        },
      });
    } catch (err) { setItems((l) => [...l, ...gone].sort(byCreated)); fail(err); }
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
          onAdd={(n, q, b) => addItem(list.id, n, q, b)}
          flash={(msg) => flash({ msg })}
          history={pastNames}
          onPatch={patchItem}
          onRemove={(i) => remove([i], `Usunięto: ${i.name}`)}
          onClearChecked={(done) => remove(done, `Usunięto kupione (${done.length})`)}
          onUncheckAll={uncheckAll}
          onSendText={() => sendText(list)}
          owner={list.owner_id === userId}
          shareInfo={shareInfo(list)}
          onSharing={() => setSharing(list.id)}
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
              const info = shareInfo(l);
              return (
                <button key={l.id} className={s.listcard} onClick={() => open(l.id)}>
                  <span className={s.lname}>{l.name}</span>
                  <span className="sub">{mine.length === 0 ? "pusta" : left === 0 ? `wszystko kupione (${mine.length})` : `do kupienia: ${left} z ${mine.length}`}</span>
                  {info && <span className={s.shared}>👥 {info}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      <p className={s.attrib}>
        Dane produktów ze skanera:{" "}
        <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a>,{" "}
        <a href="https://world.openbeautyfacts.org" target="_blank" rel="noopener noreferrer">Open Beauty Facts</a>,{" "}
        <a href="https://world.openproductsfacts.org" target="_blank" rel="noopener noreferrer">Open Products Facts</a>{" "}
        (licencja <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL</a>)
      </p>

      {list && sharing === list.id && (
        <ShareSheet
          what={`listę „${list.name}”`}
          emails={(shares[list.id] ?? []).filter((m) => m !== email)}
          owner={list.owner_id === userId}
          ownerEmail={list.owner_email}
          onAdd={(m) => shareAdd(list, m)}
          onRemove={(m) => shareRemove(list, m)}
          onLeave={() => leave(list)}
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
