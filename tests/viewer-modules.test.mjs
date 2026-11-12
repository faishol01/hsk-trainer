import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {data} from '../data/vocabulary.mjs';
import {initialPositions} from '../data/initial-positions.mjs';
import {localSentenceData} from '../data/sentence-index.mjs';
import {positions, buildWordRelationships, collectLinkedWords} from '../assets/js/relationships.mjs';
import {flashcardKey, updateFlashcardProgress, flashcardCandidates} from '../assets/js/flashcard-model.mjs';
import {makeQuizEngine, makeSentenceQuiz} from '../assets/js/quiz.mjs';
import {parseTSVLine, readIndexedSentences} from '../assets/js/sentences.mjs';
import '../assets/js/app.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('modular extraction preserves vocabulary IDs, positions, and sentence references', () => {
  assert.equal(data.length, 1993);
  assert.equal(initialPositions.length, data.length);
  assert.equal(new Set(data.map(flashcardKey)).size, data.length);
  assert.equal(hash(data), '04a151a91986d1dc711877570343b3ba49e35495d326873365c3772848c8d0ed');
  assert.equal(hash(initialPositions), 'adb38bdb26bceaaa05c2461023abf5257986707550bce56a75df2e65cdb4a5c7');
  assert.equal(hash(localSentenceData), '901052f4f55a5b1c49a59054c482e43d5a5db5c24a2ee91e876d09904b737b90');
});

test('HTML loads external styles and scripts with relative paths for GitHub Pages', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<style\b|\sstyle=|\sonclick=/i);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  assert.match(scripts[0][1], /assets\/vendor\/vis-network.min.js/);
  assert.match(scripts[1][1], /assets\/js\/bootstrap.js/);
  for (const [, attrs, contents] of scripts) {
    assert.match(attrs, /\bdefer\b/);
    assert.equal(contents.trim(), '');
  }
  const links = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)];
  assert.equal(links.length, 6);
  for (const [, path] of links) assert.ok(existsSync(new URL('../' + path, import.meta.url)), path);
});

test('relationship extraction preserves spelling and alternate-reading links', () => {
  const words = [
    ['学', 'xué', '', '', 'hsk-1'], ['学生', 'xuéshēng', '', '', 'hsk-1'],
    ['学习', 'xuéxí', '', '', 'hsk-1'], ['行', 'xíng', '', '', 'hsk-2'], ['行', 'háng', '', '', 'hsk-2']
  ];
  const result = buildWordRelationships(words);
  assert.deepEqual(positions('学', '学生'), ['prefix']);
  assert.deepEqual(positions('生', '学生'), ['suffix']);
  assert.deepEqual(positions('学', '大学生'), ['infix']);
  assert.ok(result.neighborSets[0].has(1));
  assert.ok(result.alternateReadings.has(3));
  assert.ok(result.edges.some(edge => edge.reading && edge.from === 3 && edge.to === 4));
  assert.equal(collectLinkedWords(0, result.edges, words).length, 2);
});

test('extracted flashcard model retains level selection, scheduling, and due filtering', () => {
  const entry = data[0], now = 1000;
  let record = updateFlashcardProgress(entry, null, true, now);
  assert.equal(record.dueAt, now + 86400000);
  record = updateFlashcardProgress(entry, record, true, now);
  assert.equal(record.intervalDays, 3);
  const history = new Map([[flashcardKey(entry), record]]);
  assert.equal(flashcardCandidates([entry], history, new Set(), 'all', now).length, 0);
  assert.equal(flashcardCandidates([entry], history, new Set([entry[4]]), 'due', now).length, 0);
  assert.equal(flashcardCandidates([entry], history, new Set([entry[4]]), 'all', now).length, 1);
});

test('all vocabulary quiz modes still generate one correct answer from selected words', () => {
  const words = data.slice(0, 40), neighbors = words.map(() => new Set());
  const engine = makeQuizEngine(words, neighbors);
  for (const mode of ['translation', 'character', 'pinyin']) {
    const question = engine.question(mode, words.map((_, i) => i));
    assert.ok(question, mode);
    assert.equal(question.mode, mode);
    assert.equal(question.options.length, 4);
    assert.equal(question.options.filter(option => option.correct).length, 1);
  }
});

test('sentence parser preserves quoted fields, indexed loading and mismatch errors', () => {
  assert.deepEqual(parseTSVLine('1\t"a\tb"\tc\t"quoted ""word"""\te'), ['1', 'a\tb', 'c', 'quoted "word"', 'e']);
  const rows = readIndexedSentences('1\t你好\t你好\tnǐ hǎo\thello\n2\t再见\t再見\tzàijiàn\tgoodbye', {'你好': [1]});
  assert.deepEqual(rows, {1: ['你好', 'nǐ hǎo', 'hello']});
  assert.throws(() => readIndexedSentences('', {'你好': [1]}), /missing/);
  const engine = makeSentenceQuiz(data.slice(0, 4), data.slice(0, 4).map(() => new Set()), {byWord: {}});
  assert.equal(engine.question([0, 1, 2, 3]), null);
});

test('cloud configuration is resolved from its data directory after the module move', () => {
  const source = readFileSync(new URL('../assets/js/cloud-sync.mjs', import.meta.url), 'utf8');
  assert.match(source, /\.\.\/\.\.\/data\/firebase-config\.json/);
  assert.ok(existsSync(new URL('../data/firebase-config.json', import.meta.url)));
});
