import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {data as entries} from '../data/vocabulary.mjs';
import {
  keyFor, bucketFor, packQuiz, packFlashcard, mergePacked, mergeDocument,
  aggregate, nextPacked, validPacked, MODES, BUCKETS
} from '../assets/js/cloud-sync.mjs';

const entry = ['妈', 'mā', 'noun', 'mother', 'hsk-1'];
const key = keyFor(entry), vocabulary = new Map([[key, entry]]);
const document = (device, kind, row) => ({id: `${device}_${kind}_${bucketFor(key)}`, d: device, k: kind, v: 1, c: {[key]: row}});

test('stable word-reading keys survive case, spacing, and composed tone marks', () => {
  assert.equal(keyFor(entry), keyFor(['妈', ' MA\u0304 ', '', '', 'hsk-4']));
  assert.notEqual(keyFor(entry), keyFor(['妈', 'ma', '', '', 'hsk-1']));
  assert.notEqual(keyFor(entry), keyFor(['吗', 'mā', '', '', 'hsk-1']));
  assert.equal(bucketFor(key), bucketFor(key));
  assert.ok(bucketFor(key) >= 0 && bucketFor(key) < BUCKETS);
});

test('simultaneous device quiz reviews sum without overwriting either device', () => {
  const a = nextPacked('q', null, null, true, 'translation', 1000);
  const b = nextPacked('q', null, null, false, 'pinyin', 2000);
  const combined = aggregate('q', [document('A', 'q', a), document('B', 'q', b)], vocabulary).get(key);
  assert.equal(combined.correct, 1); assert.equal(combined.incorrect, 1);
  assert.deepEqual(combined.byMode.translation, {correct: 1, incorrect: 0});
  assert.deepEqual(combined.byMode.pinyin, {correct: 0, incorrect: 1});
  assert.equal(combined.lastResult, 'incorrect');
});

test('all quiz modes retain separate counters and a latest result', () => {
  let row;
  for (const mode of MODES) row = nextPacked('q', row, null, true, mode, 1000);
  const record = aggregate('q', [document('A', 'q', row)], vocabulary).get(key);
  assert.equal(record.correct, MODES.length);
  for (const mode of MODES) assert.equal(record.byMode[mode].correct, 1);
  assert.equal(row[2], 1000 + MODES.length - 1);
});

test('stale snapshots and retried writes never decrement or double-count device counters', () => {
  const original = nextPacked('q', null, null, true, 'translation', 1000);
  const newer = nextPacked('q', original, null, false, 'character', 2000);
  let cached = document('A', 'q', newer);
  for (let i = 0; i < 5; i++) cached = mergeDocument(cached, document('A', 'q', original));
  assert.deepEqual(cached.c[key], newer);
  assert.deepEqual(mergePacked('q', newer, newer), newer);
  const result = aggregate('q', [cached], vocabulary).get(key);
  assert.equal(result.correct + result.incorrect, 2);
});

test('flashcard totals add across devices and the latest schedule wins', () => {
  const a = nextPacked('f', null, null, true, null, 1000);
  const b = nextPacked('f', null, {streak: 1}, true, null, 2000);
  const combined = aggregate('f', [document('A', 'f', a), document('B', 'f', b)], vocabulary).get(key);
  assert.equal(combined.reviews, 2); assert.equal(combined.remembered, 2);
  assert.equal(combined.streak, 2); assert.equal(combined.intervalDays, 6);
  const lapse = nextPacked('f', b, combined, false, null, 3000);
  assert.equal(lapse[3], 0); assert.equal(lapse[5], 303000);
  const reset = nextPacked('f', lapse, {streak: 0}, true, null, 4000);
  assert.equal(reset[4], 1);
});

test('simultaneous schedule timestamps resolve consistently in either arrival order', () => {
  const a = document('A', 'f', [1, 0, 1000, 1, 1, 86401000, 1]);
  const b = document('B', 'f', [0, 1, 1000, 0, 0, 301000, 0]);
  assert.deepEqual(aggregate('f', [a, b], vocabulary).get(key), aggregate('f', [b, a], vocabulary).get(key));
  assert.equal(aggregate('f', [a, b], vocabulary).get(key).lastResult, 'again');
});

test('legacy records pack without vocabulary duplication and unpack without losing history', () => {
  const quiz = {correct: 5, incorrect: 2, lastAnswered: '2026-11-11T00:00:00.000Z',
    lastResult: 'correct', byMode: {translation: {correct: 5, incorrect: 2}}};
  const packed = packQuiz(quiz);
  assert.ok(validPacked('q', packed));
  const unpacked = aggregate('q', [document('A', 'q', packed)], vocabulary).get(key);
  assert.equal(unpacked.correct, 5); assert.equal(unpacked.incorrect, 2);
  assert.equal(unpacked.lastAnswered, quiz.lastAnswered);
  const flash = {remembered: 5, again: 3, lastReviewedAt: 1000, streak: 2,
    intervalDays: 3, dueAt: 259201000, lastResult: 'remembered'};
  const record = aggregate('f', [document('A', 'f', packFlashcard(flash))], vocabulary).get(key);
  assert.equal(record.reviews, 8); assert.equal(record.dueAt, flash.dueAt);
});

test('malformed and unknown cloud records cannot enter a review deck', () => {
  assert.equal(validPacked('q', [-1, 0]), false);
  assert.equal(validPacked('f', [1, 0, Infinity, 1, 1, 1, 1]), false);
  const bad = {k: 'f', d: 'A', c: {[key]: [1], unknown: [1, 0, 1000, 1, 1, 86401000, 1]}};
  assert.equal(aggregate('f', [bad], vocabulary).size, 0);
});

test('all current vocabulary fits comfortably in four bounded documents per review type', () => {
  const shards = Array.from({length: BUCKETS}, () => ({}));
  for (const entry of entries) shards[bucketFor(keyFor(entry))][keyFor(entry)] = Array(12).fill(999999999);
  for (const c of shards) assert.ok(Buffer.byteLength(JSON.stringify(c)) < 500000);
  assert.equal(Object.values(shards).reduce((sum, c) => sum + Object.keys(c).length, 0), entries.length);
  const uncompressed = Buffer.byteLength(JSON.stringify(shards));
  assert.ok(uncompressed < 1024 * 1024);
});

test('security and index configuration only expose owner-scoped progress', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /request\.auth\.uid == uid/);
  assert.match(rules, /allow delete: if false/);
  assert.doesNotMatch(rules, /allow.*if true/);
  const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url)));
  assert.deepEqual(indexes.fieldOverrides, [{collectionGroup: 'progress', fieldPath: '*', indexes: []}]);
  const config = JSON.parse(readFileSync(new URL('../data/firebase-config.json', import.meta.url)));
  assert.equal(typeof config.enabled, 'boolean');
});

test('legacy 12-element cloud quiz rows merge cleanly with 16-element AI translation modes', () => {
  const legacy = [3, 1, 1000, 1, 2, 0, 1, 1, 0, 0, 0, 0];
  assert.ok(validPacked('q', legacy));
  const updated = nextPacked('q', legacy, null, true, 'zh-any', 2000);
  assert.ok(validPacked('q', updated));
  assert.equal(updated.length, 16);
  const merged = mergePacked('q', legacy, updated);
  const record = aggregate('q', [document('A', 'q', merged)], vocabulary).get(key);
  assert.equal(record.correct, 4);
  assert.equal(record.incorrect, 1);
  assert.deepEqual(record.byMode.translation, { correct: 2, incorrect: 0 });
  assert.deepEqual(record.byMode['zh-any'], { correct: 1, incorrect: 0 });
  assert.deepEqual(record.byMode['en-zh'], { correct: 0, incorrect: 0 });
});
