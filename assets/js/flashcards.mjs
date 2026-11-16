import { flashcardKey, flashcardCandidates } from "./flashcard-model.mjs";
import { createFlashcardStore } from "./progress.mjs";

export function initFlashcards(
  entries,
  cloudReady,
  { bindLaunch = true, onClose } = {},
) {
  const el = (id) => document.getElementById("flashcard-" + id);
  const overlay = el("overlay"),
    launch = document.getElementById("flashcard-open");
  const setup = el("setup"),
    review = el("review"),
    summary = el("summary");
  const store = createFlashcardStore(window.indexedDB, cloudReady);
  let progress = new Map(),
    queue = [],
    current = null;
  let ready = false,
    saving = false,
    revealed = false,
    attempts = 0,
    rememberedCount = 0,
    generation = 0;
  const selectedLevels = () =>
    new Set(
      [...document.querySelectorAll(".flashcard-level:checked")].map(
        (input) => input.value,
      ),
    );
  function storageStatus(message, error = false) {
    el("storage").textContent = message;
    el("storage").dataset.error = String(error);
  }
  function updateSetup() {
    const levels = selectedLevels();
    const selected = entries.filter((entry) => levels.has(entry[4]));
    const candidates = flashcardCandidates(
      entries,
      progress,
      levels,
      el("scope").value,
    );
    const newCount = selected.filter(
      (entry) => !progress.has(flashcardKey(entry)),
    ).length;
    const dueCount = selected.filter((entry) => {
      const previous = progress.get(flashcardKey(entry));
      return previous && previous.dueAt <= Date.now();
    }).length;
    el("start").disabled = !ready || candidates.length === 0;
    el("stats").textContent = !levels.size
      ? "Choose at least one HSK level to begin."
      : !ready
        ? "Loading saved progress..."
        : `${selected.length} words selected | ${newCount} new | ${dueCount} due | ${candidates.length} available for review` +
          (candidates.length
            ? ""
            : ". Nothing is due. Choose all cards to practice now.");
  }
  function showSetup() {
    setup.hidden = false;
    review.hidden = true;
    summary.hidden = true;
    current = null;
    queue = [];
    updateSetup();
    document.querySelector(".flashcard-level").focus();
  }
  async function open() {
    generation++;
    const token = generation;
    overlay.hidden = false;
    launch.setAttribute("aria-expanded", "true");
    ready = false;
    showSetup();
    storageStatus("Loading saved flashcard progress...");
    try {
      const records = await store.readAll();
      if (token !== generation) return;
      progress = new Map(records.map((record) => [record.key, record]));
      ready = true;
      storageStatus(
        "Progress is saved on this device. Cloud sync uploads it when you are signed in.",
      );
    } catch (error) {
      if (token !== generation) return;
      // Do not overwrite existing records with an empty in-memory history.
      ready = false;
      storageStatus(
        "Could not load browser storage. Close and reopen flashcards to retry. Progress has not been changed.",
        true,
      );
    }
    updateSetup();
  }
  function close({ force = false, notify = true } = {}) {
    if (saving && !force) return;
    if (force) setSaving(false);
    generation++;
    overlay.hidden = true;
    document.body.classList.remove("flashcard-active");
    launch.setAttribute("aria-expanded", "false");
    if (notify && onClose) onClose();
    else if (notify) launch.focus();
    // vis-network handles the viewport change when its container becomes visible.
    window.dispatchEvent(new Event("resize"));
  }
  function finish(completed) {
    setup.hidden = true;
    review.hidden = true;
    summary.hidden = false;
    current = null;
    el("summary-title").textContent = completed
      ? "Review complete"
      : "Review ended";
    el("summary-text").textContent =
      `${rememberedCount} cards remembered | ${attempts} ratings saved. Your next review will use your saved schedule.`;
    el("another").focus();
  }
  function showCard() {
    current = queue[0];
    if (!current) {
      finish(true);
      return;
    }
    revealed = false;
    el("answer").hidden = true;
    el("ratings").hidden = true;
    el("reveal").hidden = false;
    el("reveal").setAttribute("aria-expanded", "false");
    el("word").textContent = current[0];
    el("level-tag").textContent = "HSK " + current[4].slice(-1);
    el("pinyin").textContent = current[1];
    el("meaning").textContent = current[3];
    el("pos").textContent = current[2];
    el("session-count").textContent =
      `${queue.length} cards remaining | ${rememberedCount} remembered`;
    const saved = progress.get(flashcardKey(current));
    el("word-progress").textContent = saved
      ? `${saved.reviews} previous reviews | ${saved.remembered} remembered | ${saved.again} review again`
      : "New card";
    el("reveal").focus();
  }
  function reveal() {
    if (!current || saving || revealed) return;
    revealed = true;
    el("answer").hidden = false;
    el("ratings").hidden = false;
    el("reveal").hidden = true;
    el("reveal").setAttribute("aria-expanded", "true");
    el("again").focus();
  }
  function setSaving(next) {
    saving = next;
    ["again", "remembered", "close", "end"].forEach((id) => {
      el(id).disabled = next;
    });
    review.setAttribute("aria-busy", String(next));
  }
  async function rate(remembered) {
    if (!current || !revealed || saving) return;
    const entry = current,
      token = generation;
    setSaving(true);
    storageStatus("Saving flashcard progress...");
    try {
      const updated = await store.record(entry, remembered);
      if (token !== generation) return;
      progress.set(updated.key, updated);
      attempts++;
      queue.shift();
      if (remembered) rememberedCount++;
      else queue.push(entry);
      setSaving(false);
      storageStatus(
        "Progress saved. " +
          (remembered
            ? `Next review in ${updated.intervalDays} ${updated.intervalDays === 1 ? "day" : "days"}.`
            : "This card will appear again in this session."),
      );
      showCard();
    } catch (error) {
      if (token !== generation) return;
      setSaving(false);
      storageStatus(
        "Could not save this rating. Your card has not advanced. Please try again.",
        true,
      );
    }
  }

  window.addEventListener("hsk-progress-changed", async (event) => {
    if (overlay.hidden) return;
    if (event.detail?.accountChanged) {
      setSaving(false);
      open();
      return;
    }
    const token = generation;
    try {
      const records = await store.readAll();
      if (token !== generation) return;
      progress = new Map(records.map((record) => [record.key, record]));
      if (!setup.hidden) updateSetup();
    } catch {
      storageStatus(
        "Could not refresh progress. Close and reopen flashcards to retry.",
        true,
      );
    }
  });

  launch.disabled = false;
  if (bindLaunch) launch.addEventListener("click", open);
  el("close").addEventListener("click", close);
  document
    .querySelectorAll(".flashcard-level")
    .forEach((input) => input.addEventListener("change", updateSetup));
  el("scope").addEventListener("change", updateSetup);
  el("start").addEventListener("click", () => {
    if (!ready) return;
    queue = flashcardCandidates(
      entries,
      progress,
      selectedLevels(),
      el("scope").value,
    );
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    const limit = el("limit").value;
    if (limit !== "all") queue = queue.slice(0, Number(limit));
    if (!queue.length) {
      updateSetup();
      return;
    }
    attempts = rememberedCount = 0;
    setup.hidden = true;
    summary.hidden = true;
    review.hidden = false;
    showCard();
  });
  el("reveal").addEventListener("click", reveal);
  el("again").addEventListener("click", () => rate(false));
  el("remembered").addEventListener("click", () => rate(true));
  el("end").addEventListener("click", () => {
    if (!saving) finish(false);
  });
  el("another").addEventListener("click", showSetup);
  document.addEventListener("keydown", (event) => {
    if (!overlay.hidden && event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  return { open, close };
}
