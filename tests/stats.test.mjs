import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  buildWordStats,
  filterWordStats,
  summarizeStats,
} from "../assets/js/stats-model.mjs";
import { readProgressSnapshot } from "../assets/js/progress.mjs";
import { flashcardKey } from "../assets/js/flashcard-model.mjs";
import { readGuest } from "../assets/js/cloud-sync.mjs";

globalThis.IDBKeyRange = IDBKeyRange;
const entries = [
  ["行", "xíng", "verb", "to walk", "hsk-1"],
  ["行", "háng", "noun", "row", "hsk-2"],
  ["学", "xué", "verb", "to study", "hsk-1"],
];
const snapshot = {
  quiz: [
    {
      key: flashcardKey(entries[0]),
      correct: 1,
      incorrect: 0,
      lastResult: "correct",
      lastAnswered: "2026-11-13T00:00:00Z",
      byMode: { translation: { correct: 1, incorrect: 0 } },
    },
    {
      key: flashcardKey(entries[1]),
      correct: 1,
      incorrect: 8,
      lastResult: "incorrect",
      byMode: { pinyin: { correct: 1, incorrect: 8 } },
    },
  ],
  flashcards: [
    {
      key: flashcardKey(entries[1]),
      remembered: 2,
      again: 1,
      reviews: 3,
      streak: 1,
      intervalDays: 1,
      dueAt: 1000,
      lastReviewedAt: 500,
      lastResult: "remembered",
    },
  ],
};

test("stats show every word and keep different readings separate", () => {
  const rows = buildWordStats(entries, snapshot, 2000);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].quiz.accuracy, 100);
  assert.equal(rows[0].flashcards.reviews, 0);
  assert.equal(rows[1].quiz.total, 9);
  assert.equal(rows[1].flashcards.reviews, 3);
  assert.equal(rows[1].due, true);
  assert.equal(rows[2].practiced, false);
  assert.equal(rows[2].quiz.accuracy, null);
  assert.equal(rows[2].flashcards.dueAt, null);
});

test("summary uses total answers for accuracy instead of averaging percentages", () => {
  const result = summarizeStats(buildWordStats(entries, snapshot, 2000));
  assert.equal(result.accuracy, 20);
  assert.equal(result.answers, 10);
  assert.equal(result.practiced, 2);
  assert.equal(result.reviews, 3);
  assert.equal(result.due, 1);
  assert.equal(summarizeStats([]).accuracy, null);
});

test("quiz modes report their own counts without leaking totals between modes", () => {
  const row = buildWordStats(entries, snapshot, 2000)[1];
  assert.equal(row.quiz.modes.length, 4);
  assert.equal(row.quiz.modes.find((mode) => mode.mode === "pinyin").total, 9);
  assert.equal(
    row.quiz.modes.find((mode) => mode.mode === "translation").total,
    0,
  );
  assert.equal(
    row.quiz.modes.find((mode) => mode.mode === "sentence").accuracy,
    null,
  );
});

test("search, level, progress filters and sorts operate on a copy of the rows", () => {
  const rows = buildWordStats(entries, snapshot, 2000);
  assert.deepEqual(
    filterWordStats(rows, { query: "xing" }).map((row) => row.id),
    [0],
  );
  assert.deepEqual(
    filterWordStats(rows, { query: "to study" }).map((row) => row.id),
    [2],
  );
  assert.deepEqual(
    filterWordStats(rows, { level: "hsk-2" }).map((row) => row.id),
    [1],
  );
  assert.deepEqual(
    filterWordStats(rows, { status: "new" }).map((row) => row.id),
    [2],
  );
  assert.deepEqual(
    filterWordStats(rows, { status: "due" }).map((row) => row.id),
    [1],
  );
  assert.equal(filterWordStats(rows, { status: "practiced" }).length, 2);
  assert.deepEqual(
    filterWordStats(rows, { sort: "accuracy" }).map((row) => row.id),
    [1, 0, 2],
  );
  assert.equal(filterWordStats(rows, { sort: "due" })[0].id, 1);
  assert.deepEqual(
    rows.map((row) => row.id),
    [0, 1, 2],
  );
});

test("malformed counts and dates are not displayed as valid progress", () => {
  const rows = buildWordStats(
    entries,
    {
      quiz: [
        {
          key: flashcardKey(entries[0]),
          correct: -1,
          incorrect: "5",
          lastAnswered: "invalid",
        },
      ],
      flashcards: [
        {
          key: flashcardKey(entries[0]),
          reviews: NaN,
          remembered: -3,
          again: 0,
          dueAt: 9e18,
        },
      ],
    },
    2000,
  );
  assert.equal(rows[0].quiz.total, 0);
  assert.equal(rows[0].quiz.lastAnswered, null);
  assert.equal(rows[0].flashcards.dueAt, null);
  assert.equal(rows[0].due, false);
});

test("due filtering includes the exact due time but excludes unreviewed cards", () => {
  assert.equal(buildWordStats(entries, snapshot, 999)[1].due, false);
  assert.equal(buildWordStats(entries, snapshot, 1000)[1].due, true);
  assert.equal(
    buildWordStats(entries, { quiz: [], flashcards: [] }, 100000)[0].due,
    false,
  );
});

test("unknown historical words are excluded from current-vocabulary summary totals", () => {
  const rows = buildWordStats(entries, {
    quiz: [{ key: "unknown", correct: 100, incorrect: 20 }],
    flashcards: [],
  });
  assert.equal(summarizeStats(rows).answers, 0);
});

async function seed(api, name, store, records) {
  const db = await new Promise((resolve, reject) => {
    const request = api.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(store, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    for (const record of records) tx.objectStore(store).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

test("local stats read both original stores without changing saved progress", async () => {
  const api = new IDBFactory();
  await seed(api, "hsk-word-quiz", "wordProgress", snapshot.quiz);
  await seed(api, "hsk-word-flashcards", "cardProgress", snapshot.flashcards);
  const result = await readProgressSnapshot(api, Promise.resolve(null));
  assert.equal(result.account, null);
  const byKey = (records) => new Map(records.map((record) => [record.key, record]));
  assert.deepEqual(byKey(result.quiz), byKey(snapshot.quiz));
  assert.deepEqual(result.flashcards, snapshot.flashcards);
  assert.deepEqual(
    byKey(await readGuest(api, "hsk-word-quiz", "wordProgress")),
    byKey(snapshot.quiz),
  );
});

test("viewing new-browser stats does not create empty legacy databases", async () => {
  const api = new IDBFactory();
  assert.deepEqual(await readProgressSnapshot(api), {
    account: null,
    quiz: [],
    flashcards: [],
  });
  assert.deepEqual(await api.databases(), []);
});

test("signed-in stats use only the account cache, without reading or mixing local history", async () => {
  const accountSnapshot = {
    account: { uid: "alice", email: "alice@example.com" },
    quiz: [],
    flashcards: [],
  };
  let calls = 0;
  const cloud = {
    signedIn: () => true,
    stats: async () => {
      calls++;
      return accountSnapshot;
    },
  };
  const api = {
    open() {
      throw new Error("Local-only history must not be read");
    },
  };
  assert.equal(
    await readProgressSnapshot(api, Promise.resolve(cloud)),
    accountSnapshot,
  );
  assert.equal(calls, 1);
});

test("signing in during a local read rejects the stale source instead of displaying it", async () => {
  const api = new IDBFactory();
  let signedIn = false;
  const result = readProgressSnapshot(
    api,
    Promise.resolve({ signedIn: () => signedIn }),
  );
  queueMicrotask(() => {
    signedIn = true;
  });
  await assert.rejects(result, /Account changed/);
});

test("storage failures remain errors rather than being reported as zero practice", async () => {
  const api = {
    open() {
      throw new Error("Storage denied");
    },
  };
  await assert.rejects(readProgressSnapshot(api), /Storage denied/);
});
