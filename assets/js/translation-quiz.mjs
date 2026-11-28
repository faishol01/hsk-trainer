// AI translation practice: "Chinese → any language" and "English → Chinese".
// One AI call generates every sentence of a session; one AI call grades every answer.
import { loadGrammarData, requestAIJson, isUnauthorizedError } from "./story-ai.mjs";
import { flashcardKey, quizToQ } from "./flashcard-model.mjs";

export const TRANSLATION_DIRECTIONS = {
  "zh-any": {
    label: "Chinese → any language",
    instruction: "Translate this sentence into any language you know",
  },
  "en-zh": {
    label: "English → Chinese",
    instruction: "Translate this sentence into Chinese (Hanzi)",
  },
};

const WORDS_PER_QUESTION = 5;

function shuffled(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const levelNumber = (value) => {
  const m = String(value).match(/([1-6])/);
  return m ? Number(m[1]) : null;
};

export function describeLevels(levels) {
  const nums = [...new Set(levels.map(levelNumber).filter(Boolean))].sort((a, b) => a - b);
  if (!nums.length) return "HSK 1";
  if (nums.length === 1) return `HSK ${nums[0]}`;
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return contiguous ? `HSK ${nums[0]}–${nums.at(-1)}` : `HSK ${nums.join(", ")}`;
}

/**
 * Picks a random grammar point (distinct where possible) and a handful of suggested
 * words for every question in the session.
 * @param words vocabulary rows: [hanzi, pinyin, ?, meaning, "hsk-N"]
 */
export function pickSessionSpecs({
  grammarEntries = [],
  grammarLevels = [],
  words = [],
  wordLevels = [],
  count = 5,
  rng = Math.random,
} = {}) {
  const gLevels = new Set(grammarLevels.map(levelNumber));
  const grammarPool = grammarEntries.filter((g) => gLevels.has(g.level) && g.structure);
  if (!grammarPool.length) throw new Error("No grammar points found for the selected grammar levels.");
  const wLevels = new Set(wordLevels.map((l) => `hsk-${levelNumber(l)}`));
  const wordPool = words.filter((w) => w?.[0] && w?.[3] && wLevels.has(w[4]));
  if (!wordPool.length) throw new Error("No words found for the selected word levels.");

  const grammarOrder = [];
  while (grammarOrder.length < count) grammarOrder.push(...shuffled(grammarPool, rng));
  return grammarOrder.slice(0, count).map((grammar) => ({
    grammar,
    words: shuffled(wordPool, rng).slice(0, WORDS_PER_QUESTION),
  }));
}

export function buildGenerationPrompt({ specs, wordLevels = [], grammarLevels = [] }) {
  const wordLevelName = describeLevels(wordLevels);
  const items = specs
    .map((spec, i) => {
      const g = spec.grammar;
      const suggested = spec.words.map((w) => `${w[0]} (${w[1]}, ${w[3]})`).join("; ");
      return `${i + 1}. Grammar pattern: "${g.structure}"${g.meaning ? ` — ${g.meaning}` : ""} [HSK ${g.level}]${g.example ? `\n   Pattern example: ${g.example}` : ""}\n   Suggested words: ${suggested}`;
    })
    .join("\n");

  return `You are an expert Chinese teacher writing translation exercises for HSK learners.

Write exactly ${specs.length} independent Chinese sentences, one per item below.
Rules:
- Each sentence MUST clearly use its item's grammar pattern (grammar levels: ${describeLevels(grammarLevels)}).
- Vocabulary MUST stay within ${wordLevelName} words (plus the grammar pattern itself, numbers and simple names).
- Use at least 2 of the item's suggested words where it sounds natural.
- Sentences must be natural, self-contained, 6–25 characters, and on varied everyday topics.
- Provide accurate pinyin with tone marks and a natural English translation.

Items:
${items}

Return ONLY valid JSON (no markdown) in this exact shape:
{
  "items": [
    {
      "hanzi": "Chinese sentence",
      "pinyin": "Pinyin with tone marks",
      "english": "Natural English translation",
      "grammarNote": "One short English sentence explaining how the pattern is used here",
      "wordsUsed": ["词语"]
    }
  ]
}
The "items" array must have exactly ${specs.length} entries in the same order as the items above.`;
}

/** Fallback item built from the grammar point's curriculum example sentence. */
function exampleItem(spec) {
  const g = spec.grammar;
  return {
    hanzi: g.example || g.structure,
    pinyin: g.examplePinyin || "",
    english: g.translation || g.meaning || "",
    grammarNote: g.meaning ? `"${g.structure}" means ${g.meaning}.` : "",
    wordsUsed: [],
    grammar: g,
    words: spec.words,
    source: "example",
  };
}

export function normalizeGeneratedItems(json, specs) {
  const raw = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
  return specs.map((spec, i) => {
    const item = raw[i];
    if (!item || typeof item.hanzi !== "string" || !item.hanzi.trim() || typeof item.english !== "string" || !item.english.trim()) {
      return exampleItem(spec);
    }
    return {
      hanzi: item.hanzi.replace(/\*\*/g, "").trim(),
      pinyin: typeof item.pinyin === "string" ? item.pinyin.trim() : "",
      english: item.english.trim(),
      grammarNote: typeof item.grammarNote === "string" ? item.grammarNote.trim() : "",
      wordsUsed: Array.isArray(item.wordsUsed) ? item.wordsUsed.filter((w) => typeof w === "string") : [],
      grammar: spec.grammar,
      words: spec.words,
      source: "ai",
    };
  });
}

/** Text shown to the learner for each direction. */
export function promptText(item, direction) {
  return direction === "en-zh" ? item.english : item.hanzi;
}

export function buildGradingPrompt({ direction, items, answers }) {
  const list = items
    .map((item, i) => {
      const answer = (answers[i] || "").trim();
      return direction === "en-zh"
        ? `${i + 1}. English source: ${item.english}\n   Reference Chinese: ${item.hanzi}\n   Target grammar: "${item.grammar.structure}" (${item.grammar.meaning || ""})\n   Learner answer: ${answer || "(blank)"}`
        : `${i + 1}. Chinese source: ${item.hanzi}\n   Reference English: ${item.english}\n   Target grammar: "${item.grammar.structure}" (${item.grammar.meaning || ""})\n   Learner answer: ${answer || "(blank)"}`;
    })
    .join("\n");

  const rules =
    direction === "en-zh"
      ? `The learner translated English sentences into Chinese.
- Judge whether the Chinese is grammatical, natural and faithful to the English meaning.
- Accept any correct alternative wording; using the target grammar is encouraged but not mandatory if the answer is otherwise correct.
- Penalise wrong characters, wrong word order, missing information and wrong meaning.
- "correction" = the learner's answer with minimal edits to make it correct (or the best natural translation if the answer is unusable). Give its pinyin in "correctionPinyin".`
      : `The learner translated Chinese sentences into ANY language of their choice.
- Detect the language of each answer and report it in "detectedLanguage".
- Judge only whether the meaning faithfully conveys the Chinese sentence (all key information, who/what/when, negation, aspect, and the meaning of the target grammar).
- Ignore minor spelling, punctuation and capitalisation slips in the learner's language.
- "correction" = a natural, accurate translation written in the SAME language the learner used.`;

  return `You are a fair, encouraging Chinese teacher marking a translation exercise.
${rules}
- Score each answer from 0 to 100. verdict: "correct" (score >= 85), "partial" (50–84) or "incorrect" (< 50). Blank answers score 0.
- "feedback" = 1–2 short sentences in English explaining the main issue or confirming what was good.

Answers to mark:
${list}

Return ONLY valid JSON (no markdown) in this exact shape:
{
  "results": [
    {
      "score": 0,
      "verdict": "correct | partial | incorrect",
      "feedback": "Short feedback in English",
      "correction": "Corrected or model translation",
      "correctionPinyin": "Pinyin (only for Chinese answers, else empty)",
      "detectedLanguage": "Language of the learner's answer"
    }
  ]
}
The "results" array must have exactly ${items.length} entries in the same order.`;
}

const verdictFor = (score) => (score >= 85 ? "correct" : score >= 50 ? "partial" : "incorrect");

export function normalizeGrading(json, count) {
  const raw = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
  return Array.from({ length: count }, (_, i) => {
    const r = raw[i];
    if (!r || typeof r !== "object") {
      return { graded: false, score: null, verdict: "ungraded", feedback: "The AI did not return a mark for this answer.", correction: "", correctionPinyin: "", detectedLanguage: "" };
    }
    let score = Number(r.score);
    if (!Number.isFinite(score)) score = r.verdict === "correct" ? 100 : r.verdict === "partial" ? 60 : 0;
    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      graded: true,
      score,
      verdict: ["correct", "partial", "incorrect"].includes(r.verdict) ? r.verdict : verdictFor(score),
      feedback: typeof r.feedback === "string" ? r.feedback : "",
      correction: typeof r.correction === "string" ? r.correction : "",
      correctionPinyin: typeof r.correctionPinyin === "string" ? r.correctionPinyin : "",
      detectedLanguage: typeof r.detectedLanguage === "string" ? r.detectedLanguage : "",
    };
  });
}

export function summarizeResults(results) {
  const graded = results.filter((r) => r.graded);
  const total = graded.reduce((sum, r) => sum + r.score, 0);
  return {
    graded: graded.length,
    count: results.length,
    correct: graded.filter((r) => r.verdict === "correct").length,
    average: graded.length ? Math.round(total / graded.length) : null,
  };
}

export function describeAIError(err) {
  if (err?.code === "AI_DISABLED") return "AI is not configured for this site, so answers can't be generated or marked by AI.";
  if (err?.code === "AUTH_REQUIRED") return "Please sign in via Cloud sync to use AI translation practice.";
  if (isUnauthorizedError(err)) return "The AI service rejected the request (401 Unauthorized / App Check). Please try again later.";
  return `AI request failed: ${String(err?.message || err)}`;
}

/**
 * Generates a translation session. When AI is unavailable, falls back to the grammar
 * curriculum example sentences and reports the reason in `notice`.
 */
export async function generateTranslationSession({
  direction = "zh-any",
  words,
  wordLevels,
  grammarLevels,
  count = 5,
  fetcher = fetch,
  requestJson = requestAIJson,
  aiOptions = {},
  rng = Math.random,
} = {}) {
  const grammarEntries = await loadGrammarData(fetcher);
  const specs = pickSessionSpecs({ grammarEntries, grammarLevels, words, wordLevels, count, rng });
  let items,
    notice = "";
  try {
    const json = await requestJson({
      prompt: buildGenerationPrompt({ specs, wordLevels, grammarLevels }),
      fetcher,
      action: "GENERATE_TRANSLATION",
      ...aiOptions,
    });
    items = normalizeGeneratedItems(json, specs);
  } catch (err) {
    console.warn("Translation generation fell back to curriculum examples:", err);
    items = specs.map(exampleItem);
    notice = `${describeAIError(err)} Using curriculum example sentences instead.`;
  }
  return { direction, items, notice, wordLevels, grammarLevels };
}

/** Grades all answers of a session with a single AI call. Blank answers are not sent. */
export async function gradeTranslationSession({
  session,
  answers,
  fetcher = fetch,
  requestJson = requestAIJson,
  aiOptions = {},
} = {}) {
  const { direction, items } = session;
  const results = items.map(() => null);
  const toGrade = [];
  items.forEach((item, i) => {
    if ((answers[i] || "").trim()) toGrade.push(i);
    else results[i] = { graded: true, score: 0, verdict: "incorrect", feedback: "No answer given.", correction: "", correctionPinyin: "", detectedLanguage: "", blank: true };
  });
  if (toGrade.length) {
    const json = await requestJson({
      prompt: buildGradingPrompt({
        direction,
        items: toGrade.map((i) => items[i]),
        answers: toGrade.map((i) => answers[i]),
      }),
      fetcher,
      action: "GRADE_TRANSLATION",
      ...aiOptions,
    });
    normalizeGrading(json, toGrade.length).forEach((r, k) => {
      results[toGrade[k]] = r;
    });
  }
  return { results, summary: summarizeResults(results) };
}

const cleanHanzi = (word) => String(word || "").replace(/\d+$/, "");
const tonedPinyin = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFC");

/**
 * Converts a graded translation item into a quiz correctness flag and SM-2 q score (0–5).
 * Returns null if the item was not graded (e.g. malformed AI response).
 */
export function scoreTranslationResult(
  result,
  { timeSeconds = 15, usedHint = false } = {},
) {
  if (!result?.graded) return null;
  const time = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 15);
  const correct = result.verdict === "correct";
  const nearMiss = result.verdict === "partial";
  const rawQ = quizToQ(
    { correct, nearMiss, time, usedHint: Boolean(usedHint), type: "typed" },
    8,
    35,
  );
  const qScore = correct ? Math.max(3, rawQ) : rawQ;
  return { correct, nearMiss, qScore, time, usedHint: Boolean(usedHint) };
}

/**
 * Identifies the HSK vocabulary entries practiced in a translation question,
 * prioritizing target words suggested for the sentence (`item.words` / `item.wordsUsed`),
 * and falling back to greedy longest-match segmentation of the Chinese sentence.
 */
export function extractPracticedWords({
  item,
  direction = "zh-any",
  answer = "",
  correct = false,
  pinyinHint = "",
  words = [],
  wordLevels = [],
  maxWords = 4,
} = {}) {
  if (!item || !words.length) return [];

  const byHanzi = new Map();
  let maxLen = 1;
  for (const entry of words) {
    const h = cleanHanzi(entry?.[0]);
    if (!h) continue;
    if (h.length > maxLen) maxLen = h.length;
    if (!byHanzi.has(h)) byHanzi.set(h, []);
    byHanzi.get(h).push(entry);
  }

  const wLevels = new Set(
    (wordLevels || []).map((l) => `hsk-${levelNumber(l)}`).filter((l) => !l.endsWith("null")),
  );
  const inLevel = (entry) => !wLevels.size || wLevels.has(entry[4]);

  function resolveEntry(hanzi, pinyinSource) {
    const all = byHanzi.get(hanzi);
    if (!all?.length) return null;
    if (all.length === 1) return all[0];
    const pNorm = tonedPinyin(pinyinSource);
    if (!pNorm) return null;
    const syllables = new Set(pNorm.match(/[\p{L}]+/gu) || []);
    const compact = [...syllables].join("");
    const matches = all.filter((e) => {
      const target = tonedPinyin(e[1]).replace(/\s+/g, "");
      if (!target) return false;
      return hanzi.length === 1
        ? syllables.has(target) || pNorm.includes(target)
        : compact.includes(target) || pNorm.includes(target);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function segmentHanzi(text) {
    const ordered = [];
    const seenTokens = new Set();
    const s = String(text || "");
    for (let i = 0; i < s.length; ) {
      let matched = "";
      for (let len = Math.min(maxLen, s.length - i); len >= 1; len--) {
        const sub = s.slice(i, i + len);
        if (byHanzi.has(sub)) {
          matched = sub;
          break;
        }
      }
      if (matched) {
        if (!seenTokens.has(matched)) {
          seenTokens.add(matched);
          ordered.push(matched);
        }
        i += matched.length;
      } else {
        i += 1;
      }
    }
    return { ordered, tokenSet: seenTokens };
  }

  function collectFromText(text, pinyinSource) {
    if (!text) return [];
    const { ordered, tokenSet } = segmentHanzi(text);
    const picked = [];
    const seenKeys = new Set();
    const add = (entry) => {
      if (!entry) return;
      const key = flashcardKey(entry);
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      picked.push(entry);
    };

    for (const entry of item.words || []) {
      const h = cleanHanzi(entry?.[0]);
      if (h && (tokenSet.has(h) || (h.length >= 2 && text.includes(h)))) {
        add(entry);
      }
    }

    for (const rawWord of item.wordsUsed || []) {
      const h = cleanHanzi(rawWord);
      if (h && (tokenSet.has(h) || (h.length >= 2 && text.includes(h)))) {
        const entry = resolveEntry(h, pinyinSource);
        if (entry && inLevel(entry)) add(entry);
      }
    }

    if (picked.length < 2) {
      const candidates = ordered
        .map((t) => resolveEntry(t, pinyinSource))
        .filter(Boolean);
      const levelCandidates = candidates.filter(inLevel);
      const pool = levelCandidates.length ? levelCandidates : candidates;
      const prioritized = [
        ...pool.filter((e) => cleanHanzi(e[0]).length >= 2),
        ...pool.filter((e) => cleanHanzi(e[0]).length < 2),
      ];
      for (const entry of prioritized) {
        if (picked.length >= maxWords) break;
        add(entry);
      }
    }

    return picked.slice(0, Math.max(maxWords, (item.words || []).length));
  }

  if (direction === "en-zh" && correct && /[\u4e00-\u9fff]/.test(answer)) {
    const fromAnswer = collectFromText(
      answer,
      [pinyinHint, item.pinyin].filter(Boolean).join(" "),
    );
    if (fromAnswer.length) return fromAnswer;
  }
  return collectFromText(item.hanzi || "", item.pinyin || "");
}

/** Builds per-question word progress updates for a graded translation session. */
export function buildSessionProgressUpdates({
  session,
  answers = [],
  results = [],
  words = [],
  timesSeconds = [],
  hintsUsed = [],
} = {}) {
  if (!session?.items?.length) return [];
  return session.items.map((item, index) => {
    const result = results[index];
    const scored = scoreTranslationResult(result, {
      timeSeconds: timesSeconds[index],
      usedHint: hintsUsed[index],
    });
    if (!scored) return { index, mode: session.direction, scored: null, entries: [] };
    const entries = extractPracticedWords({
      item,
      direction: session.direction,
      answer: answers[index] || "",
      correct: scored.correct,
      pinyinHint: result?.correctionPinyin || "",
      words,
      wordLevels: session.wordLevels,
    });
    return { index, mode: session.direction, scored, entries };
  });
}

/**
 * Persists session word progress and SM-2 flashcard scheduling sequentially
 * so repeated words across questions update deterministically.
 */
export async function recordSessionProgress({
  updates = [],
  progressStore,
  flashcardStore,
} = {}) {
  const byQuestion = updates.map(() => []);
  const uniqueKeys = new Set();
  for (const u of updates) {
    if (!u?.scored || !u.entries?.length) continue;
    for (const entry of u.entries) {
      const quiz = await progressStore.record(entry, u.mode, u.scored.correct, {
        qScore: u.scored.qScore,
        time: u.scored.time,
        usedHint: u.scored.usedHint,
      });
      const flashcard = flashcardStore
        ? await flashcardStore.record(entry, u.scored.qScore, { isQuiz: true })
        : null;
      uniqueKeys.add(flashcardKey(entry));
      byQuestion[u.index].push({
        entry,
        quiz,
        flashcard,
        qScore: u.scored.qScore,
        correct: u.scored.correct,
      });
    }
  }
  return { byQuestion, totalWords: uniqueKeys.size };
}
