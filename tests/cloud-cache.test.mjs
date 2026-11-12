import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {ProgressCache, keyFor, bucketFor, readGuest} from '../assets/js/cloud-sync.mjs';

globalThis.IDBKeyRange = IDBKeyRange;
const entry = ['妈', 'mā', 'noun', 'mother', 'hsk-1'];
const key = keyFor(entry), vocabulary = new Map([[key, entry]]);
const setup = () => {
  const api = new IDBFactory();
  return {api, cache: new ProgressCache(api, vocabulary)};
};

test('concurrent tabs preserve every answer in one atomic local counter and queue', async () => {
  const {cache} = setup(), device = await cache.deviceId();
  await Promise.all(Array.from({length: 20}, (_, i) => cache.change('alice', device, 'q', entry, i % 2 === 0, 'translation')));
  const record = (await cache.records('alice', 'q')).get(key);
  assert.equal(record.correct, 10); assert.equal(record.incorrect, 10);
  const pending = await cache.list('alice', 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].revision, 20);
});

test('an old upload acknowledgement never erases answers saved during the upload', async () => {
  const {cache} = setup(), device = await cache.deviceId();
  await cache.change('alice', device, 'q', entry, true, 'translation');
  const sent = await cache.list('alice', 'pending');
  await cache.change('alice', device, 'q', entry, true, 'pinyin');
  await cache.acknowledge(sent);
  assert.equal((await cache.list('alice', 'pending')).length, 1);
  assert.equal((await cache.records('alice', 'q')).get(key).correct, 2);
  await cache.acknowledge(await cache.list('alice', 'pending'));
  assert.equal((await cache.list('alice', 'pending')).length, 0);
});

test('account switching isolates records and unsent uploads', async () => {
  const {cache} = setup(), device = await cache.deviceId();
  await cache.change('alice', device, 'f', entry, true);
  assert.equal((await cache.records('bob', 'f')).size, 0);
  assert.equal((await cache.list('bob', 'pending')).length, 0);
  await cache.change('bob', device, 'f', entry, false);
  assert.equal((await cache.records('alice', 'f')).get(key).remembered, 1);
  assert.equal((await cache.records('alice', 'f')).get(key).again, 0);
  assert.equal((await cache.records('bob', 'f')).get(key).remembered, 0);
  assert.equal((await cache.records('bob', 'f')).get(key).again, 1);
});

test('offline queue and device identity survive reinitializing the cache', async () => {
  const {api, cache} = setup(), device = await cache.deviceId();
  await cache.change('alice', device, 'q', entry, true, 'sentence');
  const reopened = new ProgressCache(api, vocabulary);
  assert.equal(await reopened.deviceId(), device);
  assert.equal((await reopened.list('alice', 'pending')).length, 1);
  assert.equal((await reopened.records('alice', 'q')).get(key).correct, 1);
});

test('stale server snapshots cannot replace a newer unsent answer', async () => {
  const {cache} = setup(), device = await cache.deviceId();
  await cache.change('alice', device, 'q', entry, true, 'translation');
  const old = (await cache.list('alice'))[0];
  await cache.change('alice', device, 'q', entry, false, 'pinyin');
  await cache.receive('alice', [old]);
  const record = (await cache.records('alice', 'q')).get(key);
  assert.equal(record.correct, 1); assert.equal(record.incorrect, 1);
  assert.equal((await cache.list('alice', 'pending'))[0].revision, 2);
});

test('two remote devices and repeated snapshots produce one combined flashcard history', async () => {
  const {cache} = setup();
  const docs = ['remote-device-aaaaaaaa', 'remote-device-bbbbbbbb'].map((d, i) => ({
    id: `${d}_f_${bucketFor(key)}`, d, v: 1, k: 'f', c: {[key]: [2, 1, 1000 + i, 2, 3, 259201000 + i, 1]}
  }));
  await cache.receive('alice', docs);
  await cache.receive('alice', docs);
  const record = (await cache.records('alice', 'f')).get(key);
  assert.equal(record.reviews, 6); assert.equal(record.remembered, 4);
  assert.equal(record.again, 2); assert.equal(record.lastReviewedAt, 1001);
  assert.equal((await cache.list('alice', 'pending')).length, 0);
});

test('explicit local history import is atomic, additive, and idempotent per account', async () => {
  const {cache} = setup(), device = await cache.deviceId();
  await cache.change('alice', device, 'q', entry, true, 'translation');
  const history = [{key, correct: 5, incorrect: 1, byMode: {translation: {correct: 5, incorrect: 1}},
    lastAnswered: '2026-11-11T00:00:00Z', lastResult: 'correct'}];
  const imported = await Promise.all([
    cache.importGuest('alice', device, history, []),
    cache.importGuest('alice', device, history, [])
  ]);
  assert.equal(imported.reduce((sum, count) => sum + count, 0), 1);
  const record = (await cache.records('alice', 'q')).get(key);
  assert.equal(record.correct, 6); assert.equal(record.incorrect, 1);
  assert.equal((await cache.records('bob', 'q')).size, 0);
  assert.equal(history[0].correct, 5);
});

test('reading a missing guest database does not create a broken empty version', async () => {
  const {api} = setup();
  assert.deepEqual(await readGuest(api, 'hsk-word-quiz', 'wordProgress'), []);
  assert.deepEqual(await api.databases(), []);
});

test('an empty import does not consume the account import opportunity', async () => {
  const {cache} = setup(), device = await cache.deviceId();
  assert.equal(await cache.importGuest('alice', device, [], []), 0);
  const history = [{key, remembered: 2, again: 1, lastReviewedAt: 1000,
    streak: 2, intervalDays: 3, dueAt: 259201000, lastResult: 'remembered'}];
  assert.equal(await cache.importGuest('alice', device, [], history), 1);
  assert.equal((await cache.records('alice', 'f')).get(key).reviews, 3);
  assert.equal(await cache.importGuest('alice', device, [], history), 0);
});

test('reading existing guest progress preserves its original records', async () => {
  const {api} = setup();
  const db = await new Promise((resolve, reject) => {
    const request = api.open('hsk-word-quiz', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('wordProgress', {keyPath: 'key'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('wordProgress', 'readwrite');
    tx.objectStore('wordProgress').put({key, correct: 7, incorrect: 2});
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
  const rows = await readGuest(api, 'hsk-word-quiz', 'wordProgress');
  assert.deepEqual(rows, [{key, correct: 7, incorrect: 2}]);
  assert.deepEqual(await readGuest(api, 'hsk-word-quiz', 'wordProgress'), rows);
});
