import { readGuest } from "./cloud-sync.mjs";
import { flashcardKey, updateFlashcardProgress } from "./flashcard-model.mjs";

export function createFlashcardStore(
  indexedDBApi,
  cloudReady = Promise.resolve(null),
) {
  let dbPromise;
  function open() {
    if (!dbPromise)
      dbPromise = new Promise((resolve, reject) => {
        if (!indexedDBApi) {
          reject(new Error("IndexedDB unavailable"));
          return;
        }
        const request = indexedDBApi.open("hsk-word-flashcards", 1);
        let failed = false;
        const fail = (error) => {
          failed = true;
          reject(error || new Error("Flashcard storage unavailable"));
        };
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("cardProgress")) {
            request.result.createObjectStore("cardProgress", {
              keyPath: "key",
            });
          }
        };
        request.onsuccess = () => {
          if (failed) {
            request.result.close();
            return;
          }
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };
        request.onerror = () => fail(request.error);
        request.onblocked = () =>
          fail(new Error("Flashcard storage is blocked by another tab"));
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
    return dbPromise;
  }
  async function readAll() {
    const cloud = await cloudReady;
    if (cloud?.signedIn()) return cloud.flashcards();
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cardProgress", "readonly");
      const request = tx.objectStore("cardProgress").getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("Could not load flashcards"));
    });
  }
  async function record(entry, remembered) {
    const cloud = await cloudReady;
    if (cloud?.signedIn()) return cloud.record("f", entry, remembered);
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cardProgress", "readwrite");
      const store = tx.objectStore("cardProgress");
      const request = store.get(flashcardKey(entry));
      let updated;
      request.onsuccess = () => {
        updated = updateFlashcardProgress(entry, request.result, remembered);
        store.put(updated);
      };
      tx.oncomplete = () => {
        notifyStats();
        resolve(updated);
      };
      tx.onerror = tx.onabort = () =>
        reject(tx.error || new Error("Could not save flashcards"));
    });
  }
  return { readAll, record };
}

export function createWordProgressStore(
  indexedDBApi,
  cloudReady = Promise.resolve(null),
) {
  let dbPromise;
  function open() {
    if (!dbPromise)
      dbPromise = new Promise((resolve, reject) => {
        if (!indexedDBApi) {
          reject(new Error("IndexedDB unavailable"));
          return;
        }
        const request = indexedDBApi.open("hsk-word-quiz", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("wordProgress"))
            request.result.createObjectStore("wordProgress", {
              keyPath: "key",
            });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error || new Error("Database unavailable"));
        request.onblocked = () => reject(new Error("Database blocked"));
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
    return dbPromise;
  }
  async function record(entry, mode, correct) {
    const cloud = await cloudReady;
    if (cloud?.signedIn()) return cloud.record("q", entry, correct, mode);
    const db = await open();
    const key = JSON.stringify([
      entry[0],
      entry[1].trim().normalize("NFC").toLowerCase(),
    ]);
    return new Promise((resolve, reject) => {
      const tx = db.transaction("wordProgress", "readwrite"),
        store = tx.objectStore("wordProgress"),
        get = store.get(key);
      let updated;
      get.onsuccess = () => {
        const old = get.result || {
          key,
          word: entry[0],
          pinyin: entry[1],
          hsk: entry[4],
          correct: 0,
          incorrect: 0,
          byMode: {},
        };
        old.correct += correct ? 1 : 0;
        old.incorrect += correct ? 0 : 1;
        const by = old.byMode[mode] || { correct: 0, incorrect: 0 };
        by.correct += correct ? 1 : 0;
        by.incorrect += correct ? 0 : 1;
        old.byMode[mode] = by;
        old.lastResult = correct ? "correct" : "incorrect";
        old.lastAnswered = new Date().toISOString();
        updated = old;
        store.put(old);
      };
      tx.oncomplete = () => {
        notifyStats();
        resolve(updated);
      };
      tx.onerror = () =>
        reject(tx.error || new Error("Could not save progress"));
      tx.onabort = () =>
        reject(tx.error || new Error("Progress transaction aborted"));
    });
  }
  return { open, record };
}

// Read a consistent source: account cache when signed in, original local stores otherwise.
export async function readProgressSnapshot(
  indexedDBApi,
  cloudReady = Promise.resolve(null),
) {
  const cloud = await cloudReady;
  if (cloud?.signedIn()) return cloud.stats();
  const [quiz, flashcards] = await Promise.all([
    readGuest(indexedDBApi, "hsk-word-quiz", "wordProgress"),
    readGuest(indexedDBApi, "hsk-word-flashcards", "cardProgress"),
  ]);
  if (cloud?.signedIn())
    throw new Error("Account changed while reading progress");
  return { account: null, quiz, flashcards };
}
function notifyStats() {
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("hsk-progress-saved"));
  }
}
