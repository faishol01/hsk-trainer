import { publishCloudStatus } from "./cloud-status.mjs";

// Compact, account-scoped progress. Vocabulary and sentences never enter Firestore.
export const SDK_VERSION = "13.2.0";
export const MODES = ["translation", "character", "pinyin", "sentence"];
export const BUCKETS = 4;
export const keyFor = (entry) =>
  JSON.stringify([entry[0], entry[1].trim().normalize("NFC").toLowerCase()]);
export function bucketFor(key) {
  let hash = 2166136261;
  for (const char of key)
    hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0) % BUCKETS;
}
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function validPacked(kind, row) {
  return (
    Array.isArray(row) &&
    row.length === (kind === "q" ? 12 : 7) &&
    row.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    (kind === "q" ? row[3] <= 1 : row[6] <= 1)
  );
}
export function packQuiz(record) {
  return [
    count(record.correct),
    count(record.incorrect),
    Date.parse(record.lastAnswered) || 0,
    record.lastResult === "correct" ? 1 : 0,
    ...MODES.flatMap((mode) => [
      count(record.byMode?.[mode]?.correct),
      count(record.byMode?.[mode]?.incorrect),
    ]),
  ];
}
export function packFlashcard(record) {
  return [
    count(record.remembered),
    count(record.again),
    count(record.lastReviewedAt),
    count(record.streak),
    count(record.intervalDays),
    count(record.dueAt),
    record.lastResult === "remembered" ? 1 : 0,
  ];
}
// Within one device: monotone counters make retries and duplicate snapshots idempotent.
export function mergePacked(kind, left, right) {
  if (!validPacked(kind, left)) return right.slice();
  if (!validPacked(kind, right)) return left.slice();
  const latest =
    left[2] === right[2]
      ? JSON.stringify(left) > JSON.stringify(right)
        ? left
        : right
      : left[2] > right[2]
        ? left
        : right;
  const result = latest.slice();
  const counters = kind === "q" ? [0, 1, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 1];
  for (const i of counters) result[i] = Math.max(left[i], right[i]);
  return result;
}
export function mergeDocument(local, incoming) {
  const c = { ...local?.c };
  for (const [key, row] of Object.entries(incoming.c || {})) {
    if (validPacked(incoming.k, row))
      c[key] = mergePacked(incoming.k, c[key], row);
  }
  return { ...incoming, c };
}
// Across devices: sum each device's counters; use the latest review for scheduling.
export function aggregate(kind, documents, vocabulary) {
  const output = new Map(),
    latest = new Map();
  for (const doc of documents) {
    if (doc.k !== kind) continue;
    for (const [key, row] of Object.entries(doc.c || {})) {
      const entry = vocabulary.get(key);
      if (!entry || !validPacked(kind, row)) continue;
      let record = output.get(key);
      if (!record) {
        record = { key, word: entry[0], pinyin: entry[1], hsk: entry[4] };
        Object.assign(
          record,
          kind === "q"
            ? { correct: 0, incorrect: 0, byMode: {} }
            : { reviews: 0, remembered: 0, again: 0 },
        );
        output.set(key, record);
      }
      if (kind === "q") {
        record.correct += row[0];
        record.incorrect += row[1];
        MODES.forEach((mode, index) => {
          const modeCounts = (record.byMode[mode] ||= {
            correct: 0,
            incorrect: 0,
          });
          modeCounts.correct += row[4 + index * 2];
          modeCounts.incorrect += row[5 + index * 2];
        });
      } else {
        record.remembered += row[0];
        record.again += row[1];
        record.reviews += row[0] + row[1];
      }
      const prior = latest.get(key);
      if (
        !prior ||
        row[2] > prior.time ||
        (row[2] === prior.time && doc.d > prior.device)
      ) {
        latest.set(key, { time: row[2], device: doc.d });
        if (kind === "q") {
          record.lastAnswered = new Date(row[2]).toISOString();
          record.lastResult = row[3] ? "correct" : "incorrect";
        } else {
          Object.assign(record, {
            lastReviewedAt: row[2],
            streak: row[3],
            intervalDays: row[4],
            dueAt: row[5],
            lastResult: row[6] ? "remembered" : "again",
          });
        }
      }
    }
  }
  return output;
}
export function nextPacked(
  kind,
  own,
  combined,
  correct,
  mode,
  now = Date.now(),
) {
  if (kind === "q") {
    const row = validPacked(kind, own) ? own.slice() : Array(12).fill(0);
    const index = MODES.indexOf(mode);
    if (index < 0) throw new Error("Unsupported quiz mode");
    row[correct ? 0 : 1]++;
    row[4 + index * 2 + (correct ? 0 : 1)]++;
    row[2] = Math.max(
      now,
      row[2] + 1,
      Date.parse(combined?.lastAnswered) + 1 || 0,
    );
    row[3] = correct ? 1 : 0;
    return row;
  }
  const row = validPacked(kind, own) ? own.slice() : Array(7).fill(0);
  const streak = correct ? (combined?.streak || 0) + 1 : 0;
  const days = correct ? [1, 3, 7, 14, 30][Math.min(streak - 1, 4)] : 0;
  row[correct ? 0 : 1]++;
  row[2] = Math.max(now, row[2] + 1, (combined?.lastReviewedAt || 0) + 1);
  row[3] = streak;
  row[4] = days;
  row[5] = row[2] + (correct ? days * 86400000 : 300000);
  row[6] = correct ? 1 : 0;
  return row;
}

const requestValue = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const transactionDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () =>
      reject(tx.error || new Error("Local progress transaction failed"));
  });
const accountRange = (uid) => IDBKeyRange.bound(uid + "/", uid + "/\uffff");

export class ProgressCache {
  constructor(indexedDBApi, vocabulary) {
    this.api = indexedDBApi;
    this.vocabulary = vocabulary;
    this.promise = null;
  }
  async open() {
    if (!this.promise)
      this.promise = new Promise((resolve, reject) => {
        if (!this.api) {
          reject(new Error("Browser storage unavailable"));
          return;
        }
        const request = this.api.open("hsk-word-cloud", 1);
        let failed = false;
        request.onupgradeneeded = () => {
          for (const name of ["meta", "documents", "pending"])
            request.result.createObjectStore(name, { keyPath: "key" });
        };
        request.onsuccess = () => {
          if (failed) {
            request.result.close();
            return;
          }
          request.result.onversionchange = () => {
            request.result.close();
            this.promise = null;
          };
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
          failed = true;
          reject(new Error("Close other tabs to enable cloud storage"));
        };
      }).catch((error) => {
        this.promise = null;
        throw error;
      });
    return this.promise;
  }
  async deviceId() {
    const db = await this.open(),
      tx = db.transaction("meta", "readwrite"),
      done = transactionDone(tx);
    const store = tx.objectStore("meta");
    let item = await requestValue(store.get("device"));
    if (!item) {
      item = { key: "device", value: crypto.randomUUID() };
      store.put(item);
    }
    await done;
    return item.value;
  }
  async list(uid, storeName = "documents") {
    const db = await this.open(),
      tx = db.transaction(storeName),
      done = transactionDone(tx);
    const records = await requestValue(
      tx.objectStore(storeName).getAll(accountRange(uid)),
    );
    await done;
    return records;
  }
  async records(uid, kind) {
    return aggregate(kind, await this.list(uid), this.vocabulary);
  }
  async change(uid, device, kind, entry, correct, mode) {
    const db = await this.open(),
      tx = db.transaction(["documents", "pending"], "readwrite");
    const done = transactionDone(tx),
      documents = tx.objectStore("documents"),
      pending = tx.objectStore("pending");
    const all = await requestValue(documents.getAll(accountRange(uid)));
    const key = keyFor(entry),
      id = `${device}_${kind}_${bucketFor(key)}`,
      localKey = uid + "/" + id;
    const local = all.find((doc) => doc.key === localKey) || {
      key: localKey,
      id,
      uid,
      v: 1,
      d: device,
      k: kind,
      c: {},
    };
    const combined = aggregate(kind, all, this.vocabulary).get(key);
    local.c[key] = nextPacked(kind, local.c[key], combined, correct, mode);
    const dirty = (await requestValue(pending.get(localKey))) || {
      ...local,
      c: {},
      revision: 0,
    };
    dirty.c[key] = local.c[key];
    dirty.revision++;
    documents.put(local);
    pending.put(dirty);
    await done;
    return aggregate(
      kind,
      [...all.filter((doc) => doc.key !== localKey), local],
      this.vocabulary,
    ).get(key);
  }
  async receive(uid, updates) {
    const db = await this.open(),
      tx = db.transaction("documents", "readwrite"),
      done = transactionDone(tx);
    const store = tx.objectStore("documents");
    for (const update of updates) {
      if (
        update.v !== 1 ||
        !["q", "f"].includes(update.k) ||
        typeof update.d !== "string"
      )
        continue;
      const key = uid + "/" + update.id,
        old = await requestValue(store.get(key));
      store.put(mergeDocument(old, { ...update, key, uid }));
    }
    await done;
  }
  async acknowledge(sent) {
    const db = await this.open(),
      tx = db.transaction("pending", "readwrite"),
      done = transactionDone(tx);
    const store = tx.objectStore("pending");
    for (const item of sent) {
      const current = await requestValue(store.get(item.key));
      if (current?.revision === item.revision) store.delete(item.key);
    }
    await done;
  }
  async importGuest(uid, device, quiz, flashcards) {
    const db = await this.open(),
      tx = db.transaction(["meta", "documents", "pending"], "readwrite");
    const done = transactionDone(tx),
      meta = tx.objectStore("meta"),
      documents = tx.objectStore("documents");
    const pending = tx.objectStore("pending"),
      marker = uid + "/guest-imported";
    if (await requestValue(meta.get(marker))) {
      await done;
      return 0;
    }
    let imported = 0;
    for (const [kind, records] of [
      ["q", quiz],
      ["f", flashcards],
    ]) {
      for (const record of records) {
        if (!this.vocabulary.has(record.key)) continue;
        const packed = kind === "q" ? packQuiz(record) : packFlashcard(record);
        if (!validPacked(kind, packed)) continue;
        const id = `${device}_${kind}_${bucketFor(record.key)}`,
          key = uid + "/" + id;
        const local = (await requestValue(documents.get(key))) || {
          key,
          id,
          uid,
          v: 1,
          d: device,
          k: kind,
          c: {},
        };
        const old = local.c[record.key];
        if (old) {
          const combined = mergePacked(kind, old, packed);
          const counters =
            kind === "q" ? [0, 1, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 1];
          for (const i of counters) combined[i] = old[i] + packed[i];
          local.c[record.key] = combined;
        } else local.c[record.key] = packed;
        const dirty = (await requestValue(pending.get(key))) || {
          ...local,
          c: {},
          revision: 0,
        };
        dirty.c[record.key] = local.c[record.key];
        dirty.revision++;
        documents.put(local);
        pending.put(dirty);
        imported++;
      }
    }
    if (imported) meta.put({ key: marker, value: true });
    await done;
    return imported;
  }
}

export function readGuest(indexedDBApi, database, objectStore) {
  return new Promise((resolve, reject) => {
    const request = indexedDBApi.open(database);
    let absent = false;
    // Opening a missing legacy DB must not leave an empty v1 DB behind.
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction.abort();
    };
    request.onerror = () => (absent ? resolve([]) : reject(request.error));
    request.onblocked = () =>
      reject(new Error("Local progress is blocked by another tab"));
    request.onsuccess = async () => {
      const db = request.result;
      try {
        if (!db.objectStoreNames.contains(objectStore)) {
          resolve([]);
          return;
        }
        const tx = db.transaction(objectStore),
          done = transactionDone(tx);
        const records = await requestValue(
          tx.objectStore(objectStore).getAll(),
        );
        await done;
        resolve(records);
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });
}

export async function initCloudSync(entries = [], { bindLaunch = true } = {}) {
  const vocabulary = new Map(entries.map((entry) => [keyFor(entry), entry]));
  const cache = new ProgressCache(window.indexedDB, vocabulary);
  const el = (id) => document.getElementById("cloud-" + id);
  const dialog = el("dialog");
  let user = null,
    device,
    auth,
    authApi,
    firestore,
    db;
  let stopListening,
    timer,
    retry = 10000,
    initialized = false;
  const flushing = new Set();
  let sequence = Promise.resolve(),
    accountGeneration = 0,
    cancelled = false,
    stopAuth;
  const bounded = (promise, milliseconds = 15000) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Cloud initialization timed out")),
        milliseconds,
      );
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => clearTimeout(timeout));
    });
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel("hsk-cloud-progress")
      : null;
  const notify = (accountChanged) =>
    window.dispatchEvent(
      new CustomEvent("hsk-progress-changed", { detail: { accountChanged } }),
    );
  let phase = "checking",
    lastMessage = "Checking cloud sync...";
  function publish() {
    publishCloudStatus({
      phase,
      account: user ? { uid: user.uid, email: user.email || null } : null,
      online: navigator.onLine !== false,
      message: lastMessage,
    });
  }
  function status(text, error = false, nextPhase = phase) {
    phase = error ? "error" : nextPhase;
    lastMessage = text;
    el("status").textContent = text;
    el("status").dataset.error = String(error);
    publish();
  }
  function controls() {
    el("signin").disabled = !initialized || Boolean(user);
    el("signout").hidden = !user;
    el("sync").disabled = !user || flushing.has(user.uid);
    el("import").disabled = !user;
    el("account").textContent = user
      ? `Signed in as ${user.email || user.uid}`
      : "Progress is currently stored on this device.";
    el("open").textContent = user ? "Cloud sync: on" : "Cloud sync";
    publish();
  }
  function schedule(delay = 10000) {
    if (timer || !user) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, delay);
  }
  async function flush() {
    if (!user || flushing.has(user.uid) || !navigator.onLine) return;
    const uid = user.uid;
    // Tabs share one outbox. A Web Lock prevents stale overlapping batches.
    if (!navigator.locks) {
      status(
        "Cloud sync needs a newer browser. Progress is saved locally.",
        true,
      );
      return;
    }
    flushing.add(uid);
    controls();
    try {
      await navigator.locks.request(
        "hsk-cloud-flush-" + uid,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            schedule();
            return;
          }
          const pending = await cache.list(uid, "pending");
          if (!pending.length) {
            status("All progress is synced.", false, "synced");
            return;
          }
          if (user?.uid !== uid) return;
          status("Syncing saved progress...", false, "syncing");
          // No per-answer cloud writes: only dirty fields in affected device buckets.
          const batch = firestore.writeBatch(db);
          for (const item of pending) {
            batch.set(
              firestore.doc(db, "users", uid, "progress", item.id),
              {
                v: 1,
                d: item.d,
                k: item.k,
                c: item.c,
                t: firestore.serverTimestamp(),
              },
              { merge: true },
            );
          }
          await batch.commit();
          await cache.acknowledge(pending);
          retry = 10000;
          if (user?.uid !== uid) return;
          const remaining = await cache.list(uid, "pending");
          status(
            remaining.length
              ? "New progress is waiting to sync."
              : "All progress is synced.",
            false,
            remaining.length ? "pending" : "synced",
          );
          if (remaining.length) schedule();
        },
      );
    } catch (error) {
      if (user?.uid === uid) {
        status(
          "Cloud sync is unavailable. Progress is saved locally and will retry.",
          true,
        );
        schedule(retry);
        retry = Math.min(retry * 2, 120000);
      }
    } finally {
      flushing.delete(uid);
      controls();
    }
  }
  const controller = {
    signedIn: () => Boolean(user),
    setVocabulary(entries) {
      vocabulary.clear();
      for (const entry of entries) vocabulary.set(keyFor(entry), entry);
    },
    open() {
      dialog.hidden = false;
    },
    close() {
      dialog.hidden = true;
    },
    async stats() {
      if (!user) throw new Error("Account changed; reopen stats");
      const account = { uid: user.uid, email: user.email || null };
      const documents = await cache.list(account.uid);
      if (user?.uid !== account.uid)
        throw new Error("Account changed while reading stats");
      return {
        account,
        quiz: [...aggregate("q", documents, vocabulary).values()],
        flashcards: [...aggregate("f", documents, vocabulary).values()],
      };
    },
    async flashcards() {
      if (!user) throw new Error("Account changed; reopen flashcards");
      return [...(await cache.records(user.uid, "f")).values()];
    },
    async record(kind, entry, correct, mode) {
      if (!user) throw new Error("Account changed; retry this answer");
      const uid = user.uid;
      const result = await cache.change(
        uid,
        device,
        kind,
        entry,
        correct,
        mode,
      );
      if (user?.uid === uid) {
        window.dispatchEvent(new CustomEvent("hsk-progress-saved"));
        status(
          "Progress saved on this device; cloud sync is pending.",
          false,
          "pending",
        );
        schedule();
      }
      channel?.postMessage({ uid });
      return result;
    },
  };
  el("open").disabled = false;
  if (bindLaunch) el("open").addEventListener("click", () => controller.open());
  el("close").addEventListener("click", () => {
    controller.close();
    window.location.hash = "#home";
  });
  el("sync").addEventListener("click", () => flush());
  el("signin").addEventListener("click", () => {
    // Called directly from a tap so mobile browsers can open the OAuth popup.
    authApi
      .signInWithPopup(auth, new authApi.GoogleAuthProvider())
      .catch((error) => {
        status(
          error.code === "auth/popup-closed-by-user"
            ? "Sign-in cancelled."
            : "Sign-in failed. Please retry. If it persists, check the authorized site domain.",
          true,
        );
      });
  });
  el("signout").addEventListener("click", async () => {
    // Pending data remains account-scoped and will retry on that account's next sign-in.
    try {
      await authApi.signOut(auth);
    } catch {
      status("Could not sign out. Please retry.", true);
    }
  });
  el("import").addEventListener("click", async () => {
    if (!user) return;
    const uid = user.uid;
    el("import").disabled = true;
    try {
      // Home/Cloud status need no word data; importing old progress does.
      if (!vocabulary.size) {
        const { data } = await import("../../data/vocabulary.mjs");
        controller.setVocabulary(data);
      }
      const [quiz, flashcards] = await Promise.all([
        readGuest(window.indexedDB, "hsk-word-quiz", "wordProgress"),
        readGuest(window.indexedDB, "hsk-word-flashcards", "cardProgress"),
      ]);
      if (user?.uid !== uid) return;
      const total = await cache.importGuest(uid, device, quiz, flashcards);
      if (user?.uid !== uid) return;
      status(
        total
          ? `${total} local records imported. Sync is pending.`
          : "No new local records to import. This browser can be imported once per account.",
      );
      notify(false);
      channel?.postMessage({ uid });
      schedule();
    } catch {
      status(
        "Could not import local progress. Existing data has not been deleted.",
        true,
      );
    } finally {
      controls();
    }
  });
  window.addEventListener("online", () => {
    publish();
    schedule(0);
  });
  window.addEventListener("offline", publish);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush().catch(() => {});
  });
  channel?.addEventListener("message", (event) => {
    if (user?.uid === event.data?.uid) {
      notify(false);
      schedule();
    }
  });
  controls();
  try {
    const response = await fetch(
      new URL("../../data/firebase-config.json", import.meta.url),
      { cache: "no-cache", signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new Error("Configuration unavailable");
    const config = await response.json();
    if (!config.enabled) {
      status(
        "Cloud sync is not enabled yet. You can keep reviewing on this device.",
        false,
        "disabled",
      );
      return controller;
    }
    if (
      !["apiKey", "authDomain", "projectId", "appId"].every(
        (key) => config.firebaseConfig?.[key],
      )
    )
      throw new Error("Configuration incomplete");
    device = await cache.deviceId();
    const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
    const [appApi, a, f] = await bounded(
      Promise.all([
        import(base + "firebase-app.js"),
        import(base + "firebase-auth.js"),
        import(base + "firebase-firestore.js"),
      ]),
    );
    authApi = a;
    firestore = f;
    const app = appApi.initializeApp(config.firebaseConfig);
    auth = a.getAuth(app);
    db = f.initializeFirestore(app, {
      localCache: f.persistentLocalCache({
        tabManager: f.persistentMultipleTabManager(),
      }),
    });
    await bounded(
      new Promise((resolve, reject) => {
        let first = true;
        stopAuth = a.onAuthStateChanged(
          auth,
          (next) => {
            if (cancelled) return;
            const generation = ++accountGeneration;
            stopListening?.();
            stopListening = null;
            clearTimeout(timer);
            timer = null;
            user = next;
            // Queue snapshot persistence so an older snapshot cannot finish after a newer one.
            sequence = sequence
              .catch(() => {})
              .then(async () => {
                if (generation !== accountGeneration) return;
                initialized = true;
                controls();
                notify(true);
                if (!next)
                  status(
                    "Sign in to sync progress between your devices. Local-only progress is unchanged.",
                    false,
                    "signed-out",
                  );
                else {
                  status("Loading cloud progress...", false, "syncing");
                  stopListening = f.onSnapshot(
                    f.collection(db, "users", next.uid, "progress"),
                    (snapshot) => {
                      const updates = snapshot
                        .docChanges()
                        .filter((change) => change.type !== "removed")
                        .map((change) => {
                          const { v, d, k, c } = change.doc.data();
                          return { id: change.doc.id, v, d, k, c };
                        });
                      sequence = sequence
                        .catch(() => {})
                        .then(async () => {
                          if (generation !== accountGeneration) return;
                          await cache.receive(next.uid, updates);
                          if (generation !== accountGeneration) return;
                          notify(false);
                          if (!snapshot.metadata.fromCache) {
                            const pending = await cache.list(
                              next.uid,
                              "pending",
                            );
                            status(
                              pending.length
                                ? "Progress saved locally; sync is pending."
                                : "All progress is synced.",
                              false,
                              pending.length ? "pending" : "synced",
                            );
                            schedule(0);
                          }
                        })
                        .catch(() =>
                          status(
                            "Could not cache cloud progress. Your existing local data is unchanged.",
                            true,
                          ),
                        );
                    },
                    () =>
                      status(
                        "Cloud sync could not connect. Check your connection and Firestore access rules. Progress stays on this device.",
                        true,
                      ),
                  );
                  schedule(0);
                }
                if (first) {
                  first = false;
                  resolve();
                }
              })
              .catch(reject);
          },
          reject,
        );
      }),
    );
  } catch (error) {
    cancelled = true;
    stopAuth?.();
    stopListening?.();
    user = null;
    initialized = false;
    controls();
    status(
      "Cloud sync could not start. Local review is still available. Check the Firebase setup and connection.",
      true,
    );
  }
  return controller;
}
