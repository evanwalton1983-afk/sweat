// Local storage for bets and settings (IndexedDB, with an in-memory fallback when the browser
// blocks it, for example in some private windows).

const DB_NAME = 'sweat';
const DB_VERSION = 1;

let dbPromise = null;
const memory = { bets: new Map(), kv: new Map() };
let memoryOnly = false;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!('indexedDB' in globalThis)) throw new Error('no indexedDB');
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bets')) db.createObjectStore('bets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        memoryOnly = true;
        resolve(null);
      };
      req.onblocked = () => {
        memoryOnly = true;
        resolve(null);
      };
    } catch {
      memoryOnly = true;
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => {
      out = v;
    });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export function isMemoryOnly() {
  return memoryOnly;
}

export async function allBets() {
  const db = await open();
  if (!db) return [...memory.bets.values()].map(clone);
  return tx(db, 'bets', 'readonly', (s) => reqP(s.getAll()));
}

export async function putBet(bet) {
  const db = await open();
  if (!db) {
    memory.bets.set(bet.id, clone(bet));
    return bet;
  }
  await tx(db, 'bets', 'readwrite', (s) => reqP(s.put(bet)));
  return bet;
}

export async function putBets(bets) {
  const db = await open();
  if (!db) {
    for (const b of bets) memory.bets.set(b.id, clone(b));
    return;
  }
  await tx(db, 'bets', 'readwrite', (s) => Promise.all(bets.map((b) => reqP(s.put(b)))));
}

export async function deleteBet(id) {
  const db = await open();
  if (!db) {
    memory.bets.delete(id);
    return;
  }
  await tx(db, 'bets', 'readwrite', (s) => reqP(s.delete(id)));
}

export async function clearAll() {
  const db = await open();
  if (!db) {
    memory.bets.clear();
    memory.kv.clear();
    return;
  }
  await tx(db, 'bets', 'readwrite', (s) => reqP(s.clear()));
  await tx(db, 'kv', 'readwrite', (s) => reqP(s.clear()));
}

export async function getKV(key, fallback = null) {
  const db = await open();
  if (!db) return memory.kv.has(key) ? clone(memory.kv.get(key)) : fallback;
  const v = await tx(db, 'kv', 'readonly', (s) => reqP(s.get(key)));
  return v === undefined ? fallback : v;
}

export async function setKV(key, value) {
  const db = await open();
  if (!db) {
    memory.kv.set(key, clone(value));
    return;
  }
  await tx(db, 'kv', 'readwrite', (s) => reqP(s.put(value, key)));
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

export function newId(prefix = 'b') {
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${r}`;
}
