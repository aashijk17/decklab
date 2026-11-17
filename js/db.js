// Tiny IndexedDB wrapper. One store, "tracks", keyed by a file fingerprint.
// It caches analysis (BPM, key, waveform) plus your hot cues and cue point,
// so a track only ever has to be analysed once.

const DB = 'decklab', STORE = 'tracks';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

export async function getTrack(id) {
  try {
    const db = await open();
    return await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(id);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  } catch { return null; }      // private mode etc: just work without a cache
}

export async function putTrack(rec) {
  try {
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { /* cache is best-effort */ }
}
