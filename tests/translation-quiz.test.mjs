import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  pickSessionSpecs,
  buildGenerationPrompt,
  normalizeGeneratedItems,
  buildGradingPrompt,
  normalizeGrading,
  generateTranslationSession,
  gradeTranslationSession,
  describeLevels,
} from "../assets/js/translation-quiz.mjs";

const grammar = [
  { level: 1, structure: "是", meaning: "to be", example: "我是学生。", examplePinyin: "wǒ shì xuésheng.", translation: "I am a student." },
  { level: 2, structure: "比", meaning: "comparison", example: "他比我高。", examplePinyin: "tā bǐ wǒ gāo.", translation: "He is taller than me." },
  { level: 3, structure: "把", meaning: "disposal", example: "把门关上。", examplePinyin: "bǎ mén guān shang.", translation: "Close the door." },
];
const words = [
  ["苹果", "píngguǒ", "", "apple", "hsk-1"],
  ["学校", "xuéxiào", "", "school", "hsk-1"],
  ["朋友", "péngyou", "", "friend", "hsk-1"],
  ["旅游", "lǚyóu", "", "to travel", "hsk-2"],
];
const fileFetcher = async (url) => ({
  ok: true,
  text: async () => readFile(url, "utf8"),
});

test("pickSessionSpecs honours grammar and word levels and fills the requested count", () => {
  const specs = pickSessionSpecs({ grammarEntries: grammar, grammarLevels: ["1", "2"], words, wordLevels: ["hsk-1"], count: 5 });
  assert.equal(specs.length, 5);
  for (const s of specs) {
    assert.ok([1, 2].includes(s.grammar.level));
    assert.ok(s.words.length > 0 && s.words.every((w) => w[4] === "hsk-1"));
  }
  // first two picks are distinct grammar points
  assert.notEqual(specs[0].grammar, specs[1].grammar);
  assert.throws(() => pickSessionSpecs({ grammarEntries: grammar, grammarLevels: ["6"], words, wordLevels: ["hsk-1"] }), /grammar/);
  assert.throws(() => pickSessionSpecs({ grammarEntries: grammar, grammarLevels: ["1"], words, wordLevels: ["hsk-4"] }), /words/);
});

test("generation and grading prompts contain the session specification", () => {
  const specs = pickSessionSpecs({ grammarEntries: grammar, grammarLevels: ["3"], words, wordLevels: ["hsk-1", "hsk-2"], count: 2 });
  const gen = buildGenerationPrompt({ specs, wordLevels: ["hsk-1", "hsk-2"], grammarLevels: ["3"] });
  assert.match(gen, /exactly 2 independent Chinese sentences/);
  assert.match(gen, /"把"/);
  assert.match(gen, /HSK 1–2 words/);
  const items = normalizeGeneratedItems({ items: [{ hanzi: "我把苹果吃了。", english: "I ate the apple.", pinyin: "wǒ bǎ píngguǒ chī le." }] }, specs);
  assert.equal(items[0].source, "ai");
  assert.equal(items[1].source, "example", "missing AI items fall back to the curriculum example");
  const zh = buildGradingPrompt({ direction: "zh-any", items, answers: ["Saya makan apel itu.", ""] });
  assert.match(zh, /ANY language/);
  assert.match(zh, /Saya makan apel itu\./);
  assert.match(zh, /\(blank\)/);
  const en = buildGradingPrompt({ direction: "en-zh", items, answers: ["我吃了苹果。", ""] });
  assert.match(en, /English source: I ate the apple\./);
  assert.equal(describeLevels(["hsk-1", "hsk-3"]), "HSK 1, 3");
});

test("normalizeGrading clamps scores, derives verdicts and marks missing entries ungraded", () => {
  const r = normalizeGrading({ results: [{ score: 140, feedback: "Great" }, { score: "55" }] }, 3);
  assert.equal(r[0].score, 100);
  assert.equal(r[0].verdict, "correct");
  assert.equal(r[1].verdict, "partial");
  assert.equal(r[2].graded, false);
});

test("a session uses one AI call to generate and one AI call to grade, skipping blanks", async () => {
  const calls = [];
  const requestJson = async ({ prompt, action }) => {
    calls.push(action);
    if (action === "GENERATE_TRANSLATION") {
      const n = Number(prompt.match(/exactly (\d+) independent/)[1]);
      return { items: Array.from({ length: n }, (_, i) => ({ hanzi: `句子${i}。`, english: `Sentence ${i}.`, pinyin: "jùzi" })) };
    }
    const n = (prompt.match(/Learner answer:/g) || []).length;
    return { results: Array.from({ length: n }, () => ({ score: 90, verdict: "correct", feedback: "Good", correction: "Sentence." })) };
  };
  const session = await generateTranslationSession({
    direction: "zh-any",
    words,
    wordLevels: ["hsk-1"],
    grammarLevels: ["1"],
    count: 3,
    fetcher: fileFetcher,
    requestJson,
  });
  assert.equal(session.items.length, 3);
  assert.equal(session.notice, "");
  assert.ok(session.items.every((it) => it.grammar.level === 1));

  const graded = await gradeTranslationSession({ session, answers: ["One", "", "Three"], requestJson });
  assert.deepEqual(calls, ["GENERATE_TRANSLATION", "GRADE_TRANSLATION"]);
  assert.equal(graded.results[1].blank, true);
  assert.equal(graded.results[1].score, 0);
  assert.equal(graded.results[0].score, 90);
  assert.equal(graded.summary.correct, 2);
  assert.equal(graded.summary.average, 60);
});

test("generation falls back to curriculum examples with a notice when AI is unavailable", async () => {
  const session = await generateTranslationSession({
    direction: "en-zh",
    words,
    wordLevels: ["hsk-1"],
    grammarLevels: ["1"],
    count: 2,
    fetcher: fileFetcher,
    requestJson: async () => {
      const e = new Error("not configured");
      e.code = "AI_DISABLED";
      throw e;
    },
  });
  assert.equal(session.items.length, 2);
  assert.ok(session.items.every((it) => it.source === "example" && it.hanzi && it.english));
  assert.match(session.notice, /not configured/);
});

test("scoreTranslationResult maps verdicts, time, and hints to SM-2 q scores", async () => {
  const { scoreTranslationResult } = await import("../assets/js/translation-quiz.mjs");
  assert.equal(scoreTranslationResult({ graded: false }), null);

  const fast = scoreTranslationResult({ graded: true, verdict: "correct", score: 95 }, { timeSeconds: 6, usedHint: false });
  assert.equal(fast.correct, true);
  assert.equal(fast.qScore, 5);

  const slowHint = scoreTranslationResult({ graded: true, verdict: "correct", score: 88 }, { timeSeconds: 40, usedHint: true });
  assert.equal(slowHint.correct, true);
  assert.equal(slowHint.qScore, 3, "correct translation never drops below SM-2 pass threshold 3");

  const partial = scoreTranslationResult({ graded: true, verdict: "partial", score: 65 }, { timeSeconds: 12 });
  assert.equal(partial.correct, false);
  assert.equal(partial.nearMiss, true);
  assert.equal(partial.qScore, 2);

  const wrong = scoreTranslationResult({ graded: true, verdict: "incorrect", score: 20 }, { timeSeconds: 12 });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.qScore, 1);
});

test("extractPracticedWords matches target words, prevents substring false-positives, and disambiguates heteronyms", async () => {
  const { extractPracticedWords } = await import("../assets/js/translation-quiz.mjs");
  const vocab = [
    ["学", "xué", "verb", "to study", "hsk-1"],
    ["学校", "xuéxiào", "noun", "school", "hsk-1"],
    ["朋友", "péngyou", "noun", "friend", "hsk-1"],
    ["苹果", "píngguǒ", "noun", "apple", "hsk-1"],
    ["行", "xíng", "verb", "okay / to walk", "hsk-1"],
    ["行", "háng", "noun", "row / profession", "hsk-2"],
  ];

  // Greedy longest-match ensures "学校" does not falsely credit "学", and unused suggested words ("苹果") are excluded
  const matched = extractPracticedWords({
    item: {
      hanzi: "我和朋友去学校。",
      pinyin: "Wǒ hé péngyou qù xuéxiào.",
      words: [vocab[0], vocab[1], vocab[2], vocab[3]],
      wordsUsed: [],
    },
    direction: "zh-any",
    correct: true,
    words: vocab,
    wordLevels: ["hsk-1"],
  });
  assert.deepEqual(matched.map((e) => e[0]), ["学校", "朋友"]);

  // Heteronym disambiguation via toned pinyin
  const heteronym = extractPracticedWords({
    item: {
      hanzi: "这样行。",
      pinyin: "Zhèyàng xíng.",
      words: [],
      wordsUsed: ["行"],
    },
    direction: "zh-any",
    correct: true,
    words: vocab,
    wordLevels: ["hsk-1", "hsk-2"],
  });
  assert.equal(heteronym.length, 1);
  assert.equal(heteronym[0][1], "xíng");
});

test("recordSessionProgress saves translation results to word progress, flashcard SM-2, and stats", async () => {
  const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
  globalThis.IDBKeyRange = IDBKeyRange;
  const { createWordProgressStore, createFlashcardStore, readProgressSnapshot } = await import("../assets/js/progress.mjs");
  const { buildWordStats } = await import("../assets/js/stats-model.mjs");
  const { buildSessionProgressUpdates, recordSessionProgress } = await import("../assets/js/translation-quiz.mjs");

  const api = new IDBFactory();
  const progressStore = createWordProgressStore(api, Promise.resolve(null));
  const flashcardStore = createFlashcardStore(api, Promise.resolve(null));

  const session = {
    direction: "zh-any",
    wordLevels: ["hsk-1"],
    items: [
      {
        hanzi: "我的朋友喜欢吃苹果。",
        pinyin: "Wǒ de péngyou xǐhuan chī píngguǒ.",
        english: "My friend likes eating apples.",
        words: [words[0], words[2]], // 苹果, 朋友
        wordsUsed: ["朋友", "苹果"],
        grammar: grammar[0],
      },
      {
        hanzi: "我去学校。",
        pinyin: "Wǒ qù xuéxiào.",
        english: "I go to school.",
        words: [words[1]], // 学校
        wordsUsed: ["学校"],
        grammar: grammar[0],
      },
    ],
  };
  const results = [
    { graded: true, score: 95, verdict: "correct" },
    { graded: true, score: 60, verdict: "partial" },
  ];

  const updates = buildSessionProgressUpdates({
    session,
    answers: ["My friend likes eating apples.", "I go home."],
    results,
    words,
    timesSeconds: [8, 20],
    hintsUsed: [false, false],
  });
  const recorded = await recordSessionProgress({ updates, progressStore, flashcardStore });
  assert.equal(recorded.totalWords, 3);

  const snapshot = await readProgressSnapshot(api, Promise.resolve(null));
  const stats = buildWordStats(words, snapshot);

  const appleStats = stats[0];
  assert.equal(appleStats.quiz.correct, 1);
  assert.equal(appleStats.quiz.incorrect, 0);
  assert.equal(appleStats.quiz.modes.find((m) => m.mode === "zh-any").correct, 1);
  assert.equal(appleStats.flashcards.remembered, 1);
  assert.equal(appleStats.flashcards.streak, 1);

  const schoolStats = stats[1];
  assert.equal(schoolStats.quiz.correct, 0);
  assert.equal(schoolStats.quiz.incorrect, 1);
  assert.equal(schoolStats.quiz.modes.find((m) => m.mode === "zh-any").incorrect, 1);
  assert.equal(schoolStats.flashcards.again, 1);
  assert.equal(schoolStats.flashcards.streak, 0);
});
