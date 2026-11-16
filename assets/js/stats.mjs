import { readProgressSnapshot } from "./progress.mjs";
import { flashcardKey } from "./flashcard-model.mjs";
import {
  buildWordStats,
  filterWordStats,
  summarizeStats,
} from "./stats-model.mjs";
import { esc } from "./utils.mjs";

const percent = (value) =>
  value === null ? "Not answered" : `${Math.round(value * 10) / 10}%`;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const date = (value) =>
  value === null ? "Never" : dateFormatter.format(value);
const metric = (label, value) =>
  `<div class="stats-metric"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
const lastQuiz = (value) =>
  value === "correct"
    ? "Correct"
    : value === "incorrect"
      ? "Incorrect"
      : "No answer yet";
const lastFlashcard = (value) =>
  value === "remembered"
    ? "Remembered"
    : value === "again"
      ? "Review again"
      : "Not reviewed";

export function initWordStats({
  entries,
  cloudReady,
  indexedDBApi = window.indexedDB,
  bindLaunch = true,
  onNavigate,
  onClose,
}) {
  const el = (id) => document.getElementById("stats-" + id);
  const view = el("view"),
    launch = el("open"),
    wordLaunch = document.getElementById("word-stats");
  const pageSize = 50;
  let rows = [],
    selected = null,
    detailKey = null,
    page = 0,
    generation = 0;

  function nextReview(row) {
    if (!row.flashcards.reviews) return "Not reviewed";
    if (row.due) return "Due now";
    return row.flashcards.dueAt === null
      ? "Not scheduled"
      : date(row.flashcards.dueAt);
  }
  function renderDetail(row) {
    el("overview").hidden = true;
    el("detail").hidden = false;
    el("back").hidden = false;
    el("word").textContent = row.entry[0];
    el("reading").textContent =
      `${row.entry[1]} | HSK ${row.entry[4].slice(-1)}`;
    el("meaning").textContent = row.entry[3];
    el("quiz-metrics").innerHTML =
      metric("Correct", row.quiz.correct) +
      metric("Incorrect", row.quiz.incorrect) +
      metric("Accuracy", percent(row.quiz.accuracy));
    el("quiz-last").textContent =
      `Last answer: ${lastQuiz(row.quiz.lastResult)} | ${date(row.quiz.lastAnswered)}`;
    el("modes").innerHTML = row.quiz.modes
      .map(
        (mode) =>
          `<tr><th scope="row">${esc(mode.label)}</th><td>${mode.correct} / ${mode.total}</td><td>${esc(percent(mode.accuracy))}</td></tr>`,
      )
      .join("");
    el("flash-metrics").innerHTML =
      metric("Reviews", row.flashcards.reviews) +
      metric("Remembered", row.flashcards.remembered) +
      metric("Review again", row.flashcards.again);
    el("flash-last").textContent =
      `Last review: ${lastFlashcard(row.flashcards.lastResult)} | ${date(row.flashcards.lastReviewedAt)}`;
    el("schedule").textContent =
      `Consecutive remembered: ${row.flashcards.streak} | Interval: ${row.flashcards.intervalDays} days | Next review: ${nextReview(row)}`;
    el("empty-word").hidden = row.practiced;
  }
  function renderOverview() {
    el("overview").hidden = false;
    el("detail").hidden = true;
    el("back").hidden = true;
    const filtered = filterWordStats(rows, {
      query: el("search").value,
      level: el("level").value,
      status: el("filter").value,
      sort: el("sort").value,
    });
    const summary = summarizeStats(filtered);
    el("summary").innerHTML =
      metric("Words practiced", `${summary.practiced} / ${summary.words}`) +
      metric("Quiz accuracy", percent(summary.accuracy)) +
      metric("Flashcard reviews", summary.reviews) +
      metric("Flashcards due", summary.due);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, pages - 1);
    const shown = filtered.slice(page * pageSize, (page + 1) * pageSize);
    el("rows").innerHTML = shown.length
      ? shown
          .map(
            (row) =>
              `<tr><th scope="row"><button type="button" data-stats-id="${row.id}"><span lang="zh-Hans">${esc(row.entry[0])}</span><small>${esc(row.entry[1])} | HSK ${esc(row.entry[4].slice(-1))}</small></button></th><td>${esc(percent(row.quiz.accuracy))}<small>${row.quiz.correct} correct / ${row.quiz.total} answers</small></td><td>${row.flashcards.reviews} reviews<small>${row.flashcards.remembered} remembered | ${row.flashcards.again} again</small></td><td>${esc(nextReview(row))}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="4">No words match these filters.</td></tr>';
    el("page").textContent =
      `${filtered.length} words | Page ${page + 1} of ${pages}`;
    el("previous").disabled = page === 0;
    el("next").disabled = page + 1 >= pages;
  }
  function render() {
    const word = detailKey && rows.find((row) => row.key === detailKey);
    if (word) renderDetail(word);
    else renderOverview();
  }
  async function refresh() {
    if (view.hidden) return;
    const token = ++generation;
    // Hide previous account data while a new snapshot is loading.
    el("content").hidden = true;
    el("back").hidden = true;
    el("context").textContent = "Loading progress...";
    el("message").textContent = "Loading saved quiz and flashcard history...";
    el("message").dataset.error = "false";
    el("refresh").disabled = true;
    try {
      const snapshot = await readProgressSnapshot(indexedDBApi, cloudReady);
      if (token !== generation || view.hidden) return;
      rows = buildWordStats(entries, snapshot);
      el("context").textContent = snapshot.account
        ? `Progress for ${snapshot.account.email || "your signed-in account"}`
        : "Local progress on this browser";
      el("message").textContent = snapshot.account
        ? "Includes progress available on this device. Cloud sync brings in updates from your other devices."
        : "Sign in with Cloud sync to view your account history. Local-only history stays separate until imported.";
      el("content").hidden = false;
      render();
    } catch {
      if (token !== generation || view.hidden) return;
      rows = [];
      el("context").textContent = "Progress unavailable";
      el("message").textContent =
        "Could not load progress. Select Refresh to try again. Your saved progress has not been changed.";
      el("message").dataset.error = "true";
    } finally {
      if (token === generation) el("refresh").disabled = false;
    }
  }
  function open(entry = null) {
    detailKey = entry ? flashcardKey(entry) : null;
    view.hidden = false;
    refresh();
  }
  launch.disabled = false;
  if (bindLaunch) launch.addEventListener("click", () => open());
  wordLaunch.addEventListener("click", () => {
    if (selected) {
      if (onNavigate) onNavigate(selected);
      else open(selected);
    }
  });
  function close({ notify = false } = {}) {
    generation++;
    view.hidden = true;
    if (notify) onClose?.();
  }
  el("close").addEventListener("click", () => close({ notify: true }));
  el("refresh").addEventListener("click", refresh);
  el("back").addEventListener("click", () => {
    detailKey = null;
    renderOverview();
  });
  el("rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stats-id]");
    const row =
      button && rows.find((row) => row.id === Number(button.dataset.statsId));
    if (row) {
      detailKey = row.key;
      renderDetail(row);
      el("back").focus();
    }
  });
  for (const id of ["search", "level", "filter", "sort"]) {
    el(id).addEventListener(id === "search" ? "input" : "change", () => {
      page = 0;
      renderOverview();
    });
  }
  el("previous").addEventListener("click", () => {
    page--;
    renderOverview();
  });
  el("next").addEventListener("click", () => {
    page++;
    renderOverview();
  });
  window.addEventListener("hsk-progress-changed", refresh);
  window.addEventListener("hsk-progress-saved", refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  return {
    open,
    close,
    setSelected(entry) {
      selected = entry;
      wordLaunch.disabled = !entry;
    },
  };
}
