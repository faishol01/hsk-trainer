import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {data} from '../data/vocabulary.mjs';
import {initialPositions} from '../data/initial-positions.mjs';
import {localSentenceData} from '../data/sentence-index.mjs';
import {positions, buildWordRelationships, collectLinkedWords} from '../assets/js/relationships.mjs';
import {flashcardKey, updateFlashcardProgress, flashcardCandidates, prioritizeFlashcards, calculateSM2, normalizeGrade, quizToQ, combineQ} from '../assets/js/flashcard-model.mjs';
import {makeQuizEngine, makeSentenceQuiz, optionDetailHTML} from '../assets/js/quiz.mjs';
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
  const bootstrapScript = scripts.find(([, attrs]) => attrs.includes('assets/js/bootstrap.js'));
  assert.ok(bootstrapScript, 'bootstrap.js must be present');
  assert.doesNotMatch(html, /src="[^"]*vis-network/);
  for (const [, attrs, contents] of scripts) {
    if (attrs.includes('recaptcha')) continue;
    assert.match(attrs, /\bdefer\b/);
    assert.equal(contents.trim(), '');
  }
  const links = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)];
  assert.ok(links.length >= 6);
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
  assert.equal(record.intervalDays, 1);
  record = updateFlashcardProgress(entry, record, true, now);
  assert.equal(record.intervalDays, 6);
  assert.equal(record.dueAt, now + 6 * 86400000);
  const history = new Map([[flashcardKey(entry), record]]);
  assert.equal(flashcardCandidates([entry], history, new Set(), 'all', now).length, 0);
  assert.equal(flashcardCandidates([entry], history, new Set([entry[4]]), 'due', now).length, 0);
  assert.equal(flashcardCandidates([entry], history, new Set([entry[4]]), 'all', now).length, 1);
});

test('SM-2 formula computes interval progression, easiness factors, and lapse resets', () => {
  const entry = data[0], now = 1000000;

  // New card rated Good (q=4)
  let p = updateFlashcardProgress(entry, null, 4, now);
  assert.equal(p.streak, 1);
  assert.equal(p.intervalDays, 1);
  assert.equal(p.easeFactor, 2.5);
  assert.equal(p.dueAt, now + 86400000);

  // Repetition 2: interval becomes 6 days
  p = updateFlashcardProgress(entry, p, 4, now);
  assert.equal(p.streak, 2);
  assert.equal(p.intervalDays, 6);
  assert.equal(p.easeFactor, 2.5);

  // Repetition 3 rated Easy (q=5): EF increases to 2.6, interval is round(6 * 2.6) = 16
  p = updateFlashcardProgress(entry, p, 5, now);
  assert.equal(p.streak, 3);
  assert.equal(p.easeFactor, 2.6);
  assert.equal(p.intervalDays, 16);

  // Repetition 4 rated Hard (q=3): EF decreases by 0.14 to 2.46, interval is round(16 * 2.46) = 39
  p = updateFlashcardProgress(entry, p, 3, now);
  assert.equal(p.streak, 4);
  assert.equal(p.easeFactor, 2.46);
  assert.equal(p.intervalDays, 39);

  // Lapse rated Again (q=1): streak resets to 0, interval resets to 0, due in 5 minutes
  p = updateFlashcardProgress(entry, p, 1, now);
  assert.equal(p.streak, 0);
  assert.equal(p.intervalDays, 0);
  assert.equal(p.dueAt, now + 300000);
  assert.equal(p.lastResult, 'again');
  assert.ok(p.easeFactor >= 1.3);

  // Re-learning: next successful rating starts from interval 1
  p = updateFlashcardProgress(entry, p, 4, now);
  assert.equal(p.streak, 1);
  assert.equal(p.intervalDays, 1);
});

test('prioritizeFlashcards puts due cards first ordered by overdueness before new cards', () => {
  const e1 = data[0]; // due earlier (most overdue)
  const e2 = data[1]; // due later (less overdue)
  const e3 = data[2]; // new card
  const e4 = data[3]; // future card (not due yet)

  const now = 500000;
  const progress = new Map([
    [flashcardKey(e1), { dueAt: now - 100000 }], // 100s overdue
    [flashcardKey(e2), { dueAt: now - 10000 }],  // 10s overdue
    [flashcardKey(e4), { dueAt: now + 50000 }],  // 50s in future
  ]);

  const ordered = prioritizeFlashcards([e3, e4, e2, e1], progress, now);
  // Expected order: e1 (most overdue), e2 (less overdue), e3 (new card), e4 (future card)
  assert.equal(ordered[0], e1);
  assert.equal(ordered[1], e2);
  assert.equal(ordered[2], e3);
  assert.equal(ordered[3], e4);

  // When filtered with scope 'due', flashcardCandidates returns [e1, e2, e3]
  const levels = new Set([e1[4], e2[4], e3[4], e4[4]]);
  const candidates = flashcardCandidates([e3, e4, e2, e1], progress, levels, 'due', now);
  assert.deepEqual(candidates, [e1, e2, e3]);
});

test('quiz setup provides checkbox options for all quiz modes with select all and clear all', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="quiz-modes"/);
  assert.match(html, /class="quiz-mode-option"\s+value="translation"/);
  assert.match(html, /class="quiz-mode-option"\s+value="character"/);
  assert.match(html, /class="quiz-mode-option"\s+value="pinyin"/);
  assert.match(html, /class="quiz-mode-option"\s+value="sentence"/);
  assert.match(html, /id="quiz-mode-all"/);
  assert.match(html, /id="quiz-mode-clear"/);
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
    for (const option of question.options) {
      assert.ok(option.entry);
      const detail = optionDetailHTML(option, mode);
      assert.ok(detail.length > 0);
      if (mode === 'translation') {
        assert.match(detail, /quiz-option-hanzi/);
        assert.match(detail, /quiz-option-pinyin/);
      }
    }
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

test('quizToQ and combineQ implement the scoring and SM-2 integration rules from QUIZ_SCORE.md', () => {
  // Default thresholds tFast=2, tSlow=10
  assert.equal(quizToQ({ correct: true, time: 2, usedHint: false, type: 'typed' }), 5);
  assert.equal(quizToQ({ correct: true, time: 6, usedHint: false, type: 'typed' }), 4);
  assert.equal(quizToQ({ correct: true, time: 10, usedHint: false, type: 'typed' }), 3);
  assert.equal(quizToQ({ correct: true, time: 10, usedHint: true, type: 'typed' }), 2);

  // Section 1 & 5: Worked examples from QUIZ_SCORE.md using custom tFast=5, tSlow=20
  // 1. Rated Good (4), typed correct in 8s -> q_quiz = 4.6, q_final = 4
  const qTyped = quizToQ({ correct: true, time: 8, usedHint: false, type: 'typed' }, 5, 20);
  assert.equal(qTyped, 4.6);
  assert.equal(combineQ(qTyped, 4, true), 4);

  // 2. Rated Easy (5), multiple-choice correct in 3s -> capped at 4, q_final = 4
  const qMcFast = quizToQ({ correct: true, time: 3, usedHint: false, type: 'multipleChoice' }, 5, 20);
  assert.equal(qMcFast, 4);
  assert.equal(combineQ(qMcFast, 5, true), 4);

  // 3. Rated Easy (5), quiz wrong -> q_quiz = 1, q_final = 1 (failure override)
  const qWrong = quizToQ({ correct: false });
  assert.equal(qWrong, 1);
  assert.equal(combineQ(qWrong, 5, false), 1);

  // 4. Rated Hard (3), quiz correct with hint -> q_quiz = 2.5, q_final = 3
  assert.equal(combineQ(2.5, 3, true), 3);

  // Near miss when wrong gives q=2
  assert.equal(quizToQ({ correct: false, nearMiss: true }), 2);

  // Section 6: Early quiz review before due date
  const entry = data[0];
  const now = 1000000000;
  const initial = updateFlashcardProgress(entry, null, 4, now - 2 * 86400000);
  initial.intervalDays = 15;
  initial.dueAt = now + 13 * 86400000; // not due yet (due in 13 days)
  initial.lastReviewedAt = now - 2 * 86400000; // reviewed 2 days ago

  // Correct early review doesn't jump to 15 * 2.5 = 38d; it keeps max(15, round(2 * 2.5)) = 15d
  const earlyReview = updateFlashcardProgress(entry, initial, 4, now, { isQuiz: true });
  assert.equal(earlyReview.intervalDays, 15);

  // Wrong early review resets as usual (forgetting early is a real signal)
  const failedEarly = updateFlashcardProgress(entry, initial, 1, now, { isQuiz: true });
  assert.equal(failedEarly.streak, 0);
  assert.equal(failedEarly.intervalDays, 0);
  assert.equal(failedEarly.dueAt, now + 300000);
});

test('cloud configuration is resolved from its data directory after the module move', () => {
  const source = readFileSync(new URL('../assets/js/cloud-sync.mjs', import.meta.url), 'utf8');
  assert.match(source, /\.\.\/\.\.\/data\/firebase-config\.json/);
  assert.ok(existsSync(new URL('../data/firebase-config.json', import.meta.url)));
});
