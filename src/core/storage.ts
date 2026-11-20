/**
 * Automatische opslag van het project in de browser (IndexedDB; ruim genoeg
 * voor KLIC-leveringen). Valt terug op localStorage voor kleine projecten.
 */
const DB = 'bouwplaats-sporthal';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveLocal(key: string, value: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    try { localStorage.removeItem(key); } catch { /* */ }
  } catch {
    try { localStorage.setItem(key, value); } catch { /* te groot of geblokkeerd */ }
  }
}

export async function loadLocal(key: string): Promise<string | null> {
  try {
    const db = await open();
    const v = await new Promise<string | null>((res, rej) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result as string) ?? null);
      r.onerror = () => rej(r.error);
    });
    db.close();
    if (v) return v;
  } catch { /* */ }
  try { return localStorage.getItem(key); } catch { return null; }
}
