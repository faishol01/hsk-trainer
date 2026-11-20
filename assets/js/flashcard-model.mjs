export function flashcardKey(entry) {
  return JSON.stringify([
    entry[0],
    entry[1].trim().normalize("NFC").toLowerCase(),
  ]);
}

export function normalizeGrade(rating) {
  if (typeof rating === "number") {
    return Math.max(0, Math.min(5, Math.round(rating)));
  }
  if (typeof rating === "boolean") {
    return rating ? 4 : 1;
  }
  if (typeof rating === "string") {
    const lower = rating.trim().toLowerCase();
    if (lower === "easy") return 5;
    if (lower === "good" || lower === "remembered") return 4;
    if (lower === "hard") return 3;
    if (lower === "again") return 1;
  }
  return rating ? 4 : 1;
}

export function calculateSM2(
  { repetitions = 0, interval = 0, easeFactor = 2.5 } = {},
  rating,
) {
  const q = normalizeGrade(rating);
  const prevEF =
    typeof easeFactor === "number" && easeFactor >= 1.3 ? easeFactor : 2.5;
  const newEF = Math.max(
    1.3,
    Math.round((prevEF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))) * 100) /
      100,
  );

  if (q < 3) {
    return {
      repetitions: 0,
      interval: 0,
      easeFactor: newEF,
      quality: q,
    };
  }

  const nextRepetitions = repetitions + 1;
  let nextInterval = 1;
  if (nextRepetitions === 1) {
    nextInterval = 1;
  } else if (nextRepetitions === 2) {
    nextInterval = 6;
  } else {
    const prevInterval = interval >= 1 ? interval : 6;
    nextInterval = Math.round(prevInterval * newEF);
  }

  return {
    repetitions: nextRepetitions,
    interval: nextInterval,
    easeFactor: newEF,
    quality: q,
  };
}

export function quizToQ(
  {
    correct,
    nearMiss = false,
    time = 0,
    usedHint = false,
    type = "multipleChoice",
  } = {},
  tFast = 2,
  tSlow = 10,
) {
  if (!correct) return nearMiss ? 2 : 1;
  const T = Math.min(1, Math.max(0, (tSlow - time) / (tSlow - tFast)));
  let q = 3 + 2 * T - (usedHint ? 1 : 0);
  const cap = type === "trueFalse" ? 3 : type === "multipleChoice" ? 4 : 5;
  return Math.max(0, Math.min(cap, Math.round(q * 10) / 10));
}

export function combineQ(qQuiz, qSelf, quizCorrect, w = 0.7) {
  if (qQuiz == null) return qSelf;
  if (qSelf == null) return qQuiz;
  if (!quizCorrect) return Math.min(qQuiz, qSelf);
  return Math.round(w * qQuiz + (1 - w) * qSelf);
}

export function updateFlashcardProgress(
  entry,
  previous,
  remembered,
  now = Date.now(),
  { isQuiz = false } = {},
) {
  let q = normalizeGrade(remembered);
  if (typeof remembered === "number") {
    q = remembered;
  }
  if (
    isQuiz &&
    previous?.lastQSelf != null &&
    previous.lastReviewedAt &&
    now - previous.lastReviewedAt < 1800000
  ) {
    q = combineQ(q, previous.lastQSelf, q >= 3);
  }

  const sm2 = calculateSM2(
    {
      repetitions: previous?.streak || 0,
      interval: previous?.intervalDays || 0,
      easeFactor: previous?.easeFactor ?? 2.5,
    },
    q,
  );
  const isRemembered = sm2.quality >= 3;
  let intervalDays = sm2.interval;

  // Cards quizzed before their due date
  if (
    isQuiz &&
    isRemembered &&
    previous &&
    typeof previous.dueAt === "number" &&
    now < previous.dueAt &&
    typeof previous.lastReviewedAt === "number"
  ) {
    const daysElapsed = Math.max(0, (now - previous.lastReviewedAt) / 86400000);
    const earlyInterval = Math.max(
      previous.intervalDays || 1,
      Math.round(daysElapsed * sm2.easeFactor),
    );
    intervalDays = earlyInterval;
  }

  const dueAt = now + (isRemembered ? intervalDays * 86400000 : 300000);

  return {
    key: flashcardKey(entry),
    word: entry[0],
    pinyin: entry[1],
    hsk: entry[4],
    reviews: (previous?.reviews || 0) + 1,
    remembered: (previous?.remembered || 0) + (isRemembered ? 1 : 0),
    again: (previous?.again || 0) + (isRemembered ? 0 : 1),
    streak: sm2.repetitions,
    intervalDays,
    easeFactor: sm2.easeFactor,
    lastResult: isRemembered ? "remembered" : "again",
    lastReviewedAt: now,
    dueAt,
    lastQSelf: isQuiz ? previous?.lastQSelf ?? null : q,
    lastQQuiz: isQuiz ? q : previous?.lastQQuiz ?? null,
  };
}

export function prioritizeFlashcards(
  candidates,
  progress,
  now = Date.now(),
  { shuffleNew = false } = {},
) {
  const due = [];
  const newCards = [];
  const future = [];

  for (const entry of candidates) {
    const prev = progress.get(flashcardKey(entry));
    if (!prev) {
      newCards.push(entry);
    } else if (prev.dueAt <= now) {
      due.push({ entry, dueAt: prev.dueAt });
    } else {
      future.push({ entry, dueAt: prev.dueAt });
    }
  }

  // Due cards are prioritized first, ordered by dueAt ascending (most overdue first)
  due.sort((a, b) => a.dueAt - b.dueAt);

  // New cards can optionally be shuffled
  if (shuffleNew) {
    for (let i = newCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newCards[i], newCards[j]] = [newCards[j], newCards[i]];
    }
  }

  // Future cards (if scope === 'all') ordered by dueAt ascending (soonest due first)
  future.sort((a, b) => a.dueAt - b.dueAt);

  return [
    ...due.map((item) => item.entry),
    ...newCards,
    ...future.map((item) => item.entry),
  ];
}

export function flashcardCandidates(
  entries,
  progress,
  levels,
  scope,
  now = Date.now(),
) {
  const seen = new Set();
  const matched = entries.filter((entry) => {
    const key = flashcardKey(entry);
    if (!levels.has(entry[4]) || seen.has(key)) return false;
    seen.add(key);
    const previous = progress.get(key);
    return scope === "all" || !previous || previous.dueAt <= now;
  });
  return prioritizeFlashcards(matched, progress, now, { shuffleNew: false });
}

