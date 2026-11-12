export function flashcardKey(entry) {
  return JSON.stringify([
    entry[0],
    entry[1].trim().normalize("NFC").toLowerCase(),
  ]);
}
export function updateFlashcardProgress(
  entry,
  previous,
  remembered,
  now = Date.now(),
) {
  const streak = remembered ? (previous?.streak || 0) + 1 : 0;
  const intervals = [1, 3, 7, 14, 30];
  const intervalDays = remembered
    ? intervals[Math.min(streak - 1, intervals.length - 1)]
    : 0;
  return {
    key: flashcardKey(entry),
    word: entry[0],
    pinyin: entry[1],
    hsk: entry[4],
    reviews: (previous?.reviews || 0) + 1,
    remembered: (previous?.remembered || 0) + (remembered ? 1 : 0),
    again: (previous?.again || 0) + (remembered ? 0 : 1),
    streak,
    intervalDays,
    lastResult: remembered ? "remembered" : "again",
    lastReviewedAt: now,
    dueAt: now + (remembered ? intervalDays * 86400000 : 300000),
  };
}
export function flashcardCandidates(
  entries,
  progress,
  levels,
  scope,
  now = Date.now(),
) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = flashcardKey(entry);
    if (!levels.has(entry[4]) || seen.has(key)) return false;
    seen.add(key);
    const previous = progress.get(key);
    return scope === "all" || !previous || previous.dueAt <= now;
  });
}
