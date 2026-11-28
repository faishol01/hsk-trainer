import { flashcardKey } from "./flashcard-model.mjs";
import { norm } from "./utils.mjs";

export const QUIZ_MODES = [
  ["translation", "Character to translation"],
  ["character", "Translation to character"],
  ["pinyin", "Character to pinyin"],
  ["sentence", "Fill in the sentence"],
  ["zh-any", "Chinese → any language"],
  ["en-zh", "English → Chinese"],
];

const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;
const timestamp = (value) => {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 8640000000000000
    ? parsed
    : null;
};
export const accuracy = (correct, total) =>
  total ? (correct / total) * 100 : null;

export function buildWordStats(entries, snapshot, now = Date.now()) {
  const quiz = new Map(snapshot.quiz.map((record) => [record.key, record]));
  const flashcards = new Map(
    snapshot.flashcards.map((record) => [record.key, record]),
  );
  return entries.map((entry, id) => {
    const key = flashcardKey(entry),
      q = quiz.get(key),
      f = flashcards.get(key);
    const correct = count(q?.correct),
      incorrect = count(q?.incorrect);
    const remembered = count(f?.remembered),
      again = count(f?.again);
    const reviews = Math.max(count(f?.reviews), remembered + again);
    const dueAt = f ? timestamp(f.dueAt) : null;
    return {
      id,
      key,
      entry,
      practiced: correct + incorrect + reviews > 0,
      due: reviews > 0 && dueAt !== null && dueAt <= now,
      quiz: {
        correct,
        incorrect,
        total: correct + incorrect,
        accuracy: accuracy(correct, correct + incorrect),
        lastAnswered: q ? timestamp(q.lastAnswered) : null,
        lastResult: q?.lastResult || null,
        modes: QUIZ_MODES.map(([mode, label]) => {
          const right = count(q?.byMode?.[mode]?.correct),
            wrong = count(q?.byMode?.[mode]?.incorrect);
          return {
            mode,
            label,
            correct: right,
            incorrect: wrong,
            total: right + wrong,
            accuracy: accuracy(right, right + wrong),
          };
        }),
      },
      flashcards: {
        reviews,
        remembered,
        again,
        streak: count(f?.streak),
        intervalDays: count(f?.intervalDays),
        lastReviewedAt: f ? timestamp(f.lastReviewedAt) : null,
        dueAt,
        lastResult: f?.lastResult || null,
      },
    };
  });
}

export function summarizeStats(rows) {
  const summary = rows.reduce(
    (result, row) => {
      result.practiced += row.practiced ? 1 : 0;
      result.correct += row.quiz.correct;
      result.answers += row.quiz.total;
      result.reviews += row.flashcards.reviews;
      result.due += row.due ? 1 : 0;
      return result;
    },
    {
      words: rows.length,
      practiced: 0,
      correct: 0,
      answers: 0,
      reviews: 0,
      due: 0,
    },
  );
  return { ...summary, accuracy: accuracy(summary.correct, summary.answers) };
}

export function filterWordStats(
  rows,
  { query = "", level = "all", status = "all", sort = "reviewed" } = {},
) {
  const search = norm(query.trim());
  const result = rows.filter(
    (row) =>
      (level === "all" || row.entry[4] === level) &&
      (!search || norm(row.entry.join(" ")).includes(search)) &&
      (status === "all" ||
        (status === "new" && !row.practiced) ||
        (status === "practiced" && row.practiced) ||
        (status === "due" && row.due)),
  );
  const reviews = (row) => row.quiz.total + row.flashcards.reviews;
  return result.sort((a, b) => {
    if (sort === "accuracy") {
      const delta =
        (a.quiz.accuracy ?? Infinity) - (b.quiz.accuracy ?? Infinity);
      if (Number.isFinite(delta) && delta) return delta;
      if (a.quiz.accuracy === null && b.quiz.accuracy !== null) return 1;
      if (b.quiz.accuracy === null && a.quiz.accuracy !== null) return -1;
    } else if (sort === "due") {
      const delta = Number(b.due) - Number(a.due);
      if (delta) return delta;
      const date =
        (a.flashcards.dueAt ?? Infinity) - (b.flashcards.dueAt ?? Infinity);
      if (Number.isFinite(date) && date) return date;
      if (a.flashcards.dueAt === null && b.flashcards.dueAt !== null) return 1;
      if (b.flashcards.dueAt === null && a.flashcards.dueAt !== null) return -1;
    } else if (sort === "pinyin") {
      const delta = norm(a.entry[1]).localeCompare(norm(b.entry[1]));
      if (delta) return delta;
    } else if (reviews(a) !== reviews(b)) return reviews(b) - reviews(a);
    return a.id - b.id;
  });
}
