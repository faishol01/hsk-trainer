import { esc } from "./utils.mjs";
import { createWordProgressStore, createFlashcardStore } from "./progress.mjs";
import { quizToQ } from "./flashcard-model.mjs";

export function makeQuizEngine(data, neighborSets) {
  const readings = new Map();
  data.forEach((d) => {
    if (!readings.has(d[0])) readings.set(d[0], new Set());
    readings.get(d[0]).add(d[1].trim().normalize("NFC").toLowerCase());
  });
  const strip = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  const tokens = (s) =>
    new Set(
      (s.toLowerCase().match(/[a-z]+/g) || []).filter(
        (x) =>
          x.length > 2 &&
          ![
            "the",
            "and",
            "for",
            "with",
            "to",
            "of",
            "measure",
            "word",
          ].includes(x),
      ),
    );
  const textTokens = data.map((d) => tokens(d[3]));
  const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  function answer(d, mode) {
    return mode === "translation"
      ? d[3].trim()
      : mode === "character"
        ? d[0].trim()
        : d[1].trim();
  }
  function score(i, j, mode) {
    let a = data[i],
      b = data[j],
      score = neighborSets[i].has(j) ? 7 : 0;
    if (a[4] === b[4]) score += 1.5;
    if (a[0] !== b[0] && [...a[0]].some((c) => b[0].includes(c))) score += 2;
    let ap = strip(a[1]),
      bp = strip(b[1]);
    if (ap && bp) {
      if (ap === bp) score += mode === "pinyin" ? 16 : 4;
      else if (ap.slice(0, 2) === bp.slice(0, 2)) score += 2;
    }
    let overlap = 0;
    for (const x of textTokens[i]) if (textTokens[j].has(x)) overlap++;
    score += Math.min(overlap, 3) * 3;
    return score + Math.random() * 1.8;
  }
  function question(mode, eligible, previous = -1) {
    if (mode === "mix") mode = choose(["translation", "character", "pinyin"]);
    const pool = eligible.filter(
      (i) =>
        data[i][0] &&
        data[i][1] &&
        data[i][3] &&
        (mode === "character" || readings.get(data[i][0]).size === 1),
    );
    if (pool.length < 4) return null;
    const candidates = shuffle(pool.filter((i) => i !== previous));
    for (const id of candidates) {
      let correct = answer(data[id], mode),
        seen = new Set([correct.toLocaleLowerCase()]);
      let distractors = pool
        .filter(
          (j) =>
            j !== id &&
            data[j][0] !== data[id][0] &&
            (mode !== "character" ||
              data[j][3].trim().toLowerCase() !==
                data[id][3].trim().toLowerCase()) &&
            answer(data[j], mode).toLocaleLowerCase() !==
              correct.toLocaleLowerCase(),
        )
        .map((j) => ({ j, s: score(id, j, mode) }))
        .sort((a, b) => b.s - a.s);
      let options = [{ id, text: correct, correct: true, entry: data[id] }];
      for (const item of distractors) {
        let value = answer(data[item.j], mode),
          key = value.toLocaleLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          options.push({
            id: item.j,
            text: value,
            correct: false,
            entry: data[item.j],
          });
          if (options.length === 4) break;
        }
      }
      if (options.length === 4)
        return {
          id,
          mode,
          prompt: mode === "character" ? data[id][3] : data[id][0],
          options: shuffle(options),
          entry: data[id],
        };
    }
    return null;
  }
  return { question };
}

export function makeSentenceQuiz(data, neighborSets, sentenceData) {
  const readingCounts = new Map();
  const wordsByChar = new Map();
  data.forEach((d) => {
    if (!readingCounts.has(d[0])) readingCounts.set(d[0], new Set());
    readingCounts.get(d[0]).add(d[1].toLowerCase().trim());
    if (!wordsByChar.has(d[0])) wordsByChar.set(d[0], d);
  });
  const choose = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const norm = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/g, "");
  function pinyinHint(pinyin, entries) {
    const chars = [...pinyin],
      map = [],
      flat = [];
    chars.forEach((c, i) => {
      for (const a of norm(c)) {
        flat.push(a);
        map.push(i);
      }
    });
    let text = flat.join(""),
      spans = [];
    for (const entry of entries) {
      let term = norm(entry[1]);
      if (!term || !text.includes(term)) return null;
      let pos = 0;
      while ((pos = text.indexOf(term, pos)) !== -1) {
        spans.push([map[pos], map[pos + term.length - 1]]);
        pos += term.length;
      }
    }
    let hidden = new Set();
    for (let [a, b] of spans) for (let i = a; i <= b; i++) hidden.add(i);
    let out = "",
      was = false;
    chars.forEach((c, i) => {
      if (hidden.has(i)) {
        if (!was) out += "____";
        was = true;
      } else {
        out += c;
        was = false;
      }
    });
    return out;
  }
  function question(eligible, previous = -1) {
    const pool = eligible.filter(
      (i) =>
        data[i][0] &&
        data[i][1] &&
        data[i][3] &&
        readingCounts.get(data[i][0]).size === 1 &&
        sentenceData.byWord[data[i][0]]?.length,
    );
    if (pool.length < 4) return null;
    const all = shuffle(pool.filter((i) => i !== previous));
    for (const id of all) {
      let target = data[id],
        sentences = shuffle([...sentenceData.byWord[target[0]]]);
      for (const sid of sentences) {
        let row = sentenceData.sentences[sid],
          zh = row[0],
          at = zh.indexOf(target[0]);
        if (
          at < 0 ||
          zh.indexOf(target[0], at + target[0].length) !== -1 ||
          !pinyinHint(row[1], [target])
        )
          continue;
        let blanks = [{ id, at, end: at + target[0].length }];
        if (Math.random() < 0.5) {
          let candidates = shuffle(
            pool.filter(
              (j) =>
                j !== id && data[j][0] !== target[0] && zh.includes(data[j][0]),
            ),
          );
          for (const j of candidates) {
            let w = data[j][0],
              pos = zh.indexOf(w);
            if (
              pos < 0 ||
              zh.indexOf(w, pos + w.length) !== -1 ||
              !(pos + w.length <= at || pos >= at + target[0].length) ||
              !pinyinHint(row[1], [target, data[j]])
            )
              continue;
            blanks.push({ id: j, at: pos, end: pos + w.length });
            break;
          }
        }
        blanks.sort((a, b) => a.at - b.at);
        let entries = blanks.map((x) => data[x.id]),
          correct = entries.map((d) => d[0]);
        let alternatives = blanks.map((b) =>
          shuffle(pool.filter((j) => !correct.includes(data[j][0])))
            .map((j) => ({
              j,
              score:
                (neighborSets[b.id].has(j) ? 8 : 0) +
                (data[j][4] === data[b.id][4] ? 2 : 0) +
                (norm(data[j][1]).slice(0, 2) ===
                norm(data[b.id][1]).slice(0, 2)
                  ? 2
                  : 0) +
                Math.random(),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 12)
            .map((x) => data[x.j][0]),
        );
        if (alternatives.some((a) => new Set(a).size < 3)) continue;
        let variants = [correct];
        for (let k = 0; variants.length < 4 && k < 20; k++) {
          let copy = correct.slice(),
            idx = k % copy.length;
          copy[idx] = alternatives[idx][k % alternatives[idx].length];
          if (copy.length === 2 && k % 3 === 2)
            copy[1 - idx] =
              alternatives[1 - idx][(k + 3) % alternatives[1 - idx].length];
          if (!variants.some((v) => v.join("\u0000") === copy.join("\u0000")))
            variants.push(copy);
        }
        if (variants.length < 4) continue;
        let prompt = "",
          cursor = 0;
        for (const b of blanks) {
          prompt += zh.slice(cursor, b.at) + " ____ ";
          cursor = b.end;
        }
        prompt += zh.slice(cursor);
        return {
          id,
          mode: "sentence",
          prompt,
          entry: target,
          entries,
          sentence: row,
          pinyinHint: pinyinHint(row[1], entries),
          options: shuffle(
            variants.map((v, i) => {
              const matched = v
                .map((w) => wordsByChar.get(w))
                .filter(Boolean);
              return {
                text: v.join(" / "),
                correct: i === 0,
                entry: matched[0] || null,
                entries: matched,
              };
            }),
          ),
        };
      }
    }
    return null;
  }
  return { question, pinyinHint };
}

export function optionDetailHTML(option, mode) {
  const entry = option?.entry;
  if (!entry) return "";
  const [word, pinyin, , meaning] = entry;
  if (mode === "translation") {
    return `<span class="quiz-option-hanzi" lang="zh-Hans">${esc(word)}</span> <span class="quiz-option-pinyin" lang="zh-Latn">${esc(pinyin)}</span>`;
  }
  if (mode === "character") {
    return `<span class="quiz-option-pinyin" lang="zh-Latn">${esc(pinyin)}</span> · <span class="quiz-option-meaning">${esc(meaning)}</span>`;
  }
  if (mode === "pinyin") {
    return `<span class="quiz-option-hanzi" lang="zh-Hans">${esc(word)}</span> · <span class="quiz-option-meaning">${esc(meaning)}</span>`;
  }
  if (mode === "sentence") {
    if (option.entries?.length > 1) {
      return option.entries
        .map(
          (e) =>
            `<span class="quiz-option-hanzi" lang="zh-Hans">${esc(e[0])}</span> (<span class="quiz-option-pinyin" lang="zh-Latn">${esc(e[1])}</span> · ${esc(e[3])})`,
        )
        .join(" / ");
    }
    return `<span class="quiz-option-pinyin" lang="zh-Latn">${esc(pinyin)}</span> · <span class="quiz-option-meaning">${esc(meaning)}</span>`;
  }
  return `<span class="quiz-option-hanzi" lang="zh-Hans">${esc(word)}</span> · <span class="quiz-option-pinyin" lang="zh-Latn">${esc(pinyin)}</span> · ${esc(meaning)}`;
}

export function initQuiz({
  data,
  neighborSets,
  localSentenceData,
  cloudReady,
  getSentenceCorpus,
  network,
  isLayoutFixed = () => false,
  bindLaunch = true,
  onClose,
}) {
  const sentenceQuiz = makeSentenceQuiz(data, neighborSets, localSentenceData);
  const quizEngine = makeQuizEngine(data, neighborSets),
    quizOverlay = document.querySelector("#quiz-overlay"),
    quizMode = document.querySelector("#quiz-mode"),
    quizBody = document.querySelector("#quiz-body"),
    quizNext = document.querySelector("#quiz-next"),
    quizScore = document.querySelector("#quiz-score"),
    quizSetup = document.querySelector("#quiz-setup"),
    quizTest = document.querySelector("#quiz-test"),
    quizDbNote = document.querySelector("#quiz-db-note"),
    quizWordProgress = document.querySelector("#quiz-word-progress");
  const quizTranslate = document.querySelector("#quiz-translate"),
    translateBody = document.querySelector("#translate-body"),
    translateProgress = document.querySelector("#translate-progress"),
    translateNotice = document.querySelector("#translate-notice");
  const progressStore = createWordProgressStore(window.indexedDB, cloudReady);
  const flashcardStore = createFlashcardStore(window.indexedDB, cloudReady);
  let quizCurrent = null,
    quizLast = -1,
    quizCorrect = 0,
    quizTotal = 0,
    questionStartTime = Date.now(),
    hintUsed = false;

  function getSelectedModes() {
    const checked = [
      ...document.querySelectorAll(".quiz-mode-option:checked"),
    ].map((el) => el.value);
    if (checked.length > 0) return checked;
    if (quizMode?.value) {
      return quizMode.value === "mix"
        ? ["translation", "character", "pinyin", "sentence"]
        : [quizMode.value];
    }
    return ["translation"];
  }

  function updateModeSelection() {
    const checked = [
      ...document.querySelectorAll(".quiz-mode-option:checked"),
    ].map((el) => el.value);
    if (quizMode) {
      quizMode.value =
        checked.length === 1 ? checked[0] : checked.length > 1 ? "mix" : "";
    }
    document.querySelectorAll(".quiz-mode-card").forEach((card) => {
      const input = card.querySelector?.(".quiz-mode-option");
      if (input?.checked) card.classList?.add?.("checked");
      else card.classList?.remove?.("checked");
    });
  }

  function updateLevelSelection() {
    document.querySelectorAll(".quiz-levels label").forEach((label) => {
      const input = label.querySelector?.(".quiz-level");
      if (input?.checked) label.classList?.add?.("checked");
      else label.classList?.remove?.("checked");
    });
  }

  function quizNextQuestion() {
    let levels = new Set(
      [...document.querySelectorAll(".quiz-level:checked")].map(
        (el) => el.value,
      ),
    );
    let eligible = data.map((_, i) => i).filter((i) => levels.has(data[i][4]));
    const modes = getSelectedModes();
    if (!modes.length) {
      document.querySelector("#quiz-setup-error").textContent =
        "Choose at least one quiz mode to continue.";
      return false;
    }
    const mode = modes[Math.floor(Math.random() * modes.length)];
    let question =
      mode === "sentence"
        ? sentenceQuiz.question(eligible, quizLast)
        : quizEngine.question(mode, eligible, quizLast);
    quizNext.hidden = true;
    if (!question) {
      document.querySelector("#quiz-setup-error").textContent =
        "Not enough distinct words match these levels. Select more levels to continue.";
      return false;
    }
    document.querySelector("#quiz-setup-error").textContent = "";
    quizCurrent = question;
    quizLast = question.id;
    quizWordProgress.textContent = "";
    questionStartTime = Date.now();
    hintUsed = false;
    let label =
      question.mode === "sentence"
        ? "Choose the missing word or words"
        : question.mode === "translation"
          ? "Choose the English translation"
          : question.mode === "character"
            ? "Choose the Chinese characters"
            : "Choose the pinyin with the correct tones";
    let hints =
      question.mode === "sentence"
        ? `<div class="quiz-hints"><button type="button" data-hint="pinyin">Show pinyin</button><button type="button" data-hint="translation">Show translation</button></div><p id="quiz-hint-pinyin" class="quiz-meta" hidden>${esc(question.pinyinHint)}</p><p id="quiz-hint-translation" class="quiz-meta" hidden>${esc(question.sentence[2])}</p>`
        : "";
    quizBody.innerHTML = `<p class="quiz-prompt-label">${label}</p><div class="quiz-prompt">${esc(question.prompt)}</div>${hints}<div class="quiz-options">${question.options
      .map((o, i) => {
        const detail = optionDetailHTML(o, question.mode);
        return `<button type="button" class="quiz-option" data-option="${i}"><span class="quiz-option-text">${esc(o.text)}</span>${detail ? `<span class="quiz-option-detail" hidden style="display: none;">${detail}</span>` : ""}</button>`;
      })
      .join("")}</div><p class="quiz-feedback" aria-live="polite"></p>`;
    return true;
  }
  window.addEventListener("hsk-progress-changed", (e) => {
    if (e.detail?.accountChanged && !quizOverlay.hidden) showQuizSetup();
  });
  function showQuizSetup() {
    quizSetup.hidden = false;
    quizTest.hidden = true;
    if (quizTranslate) quizTranslate.hidden = true;
    translateRun++; // cancel any pending AI translation request
    quizCurrent = null;
    quizLast = -1;
    quizCorrect = quizTotal = 0;
    quizScore.textContent = "Score: 0 / 0";
    document.querySelector("#quiz-setup-error").textContent = "";
    updateModeSelection();
    updateLevelSelection();
    updateQuizType();
    document.querySelector(".quiz-mode-option")?.focus();
  }

  // ---------- AI translation sessions ----------
  let translationModule = null,
    translateSession = null,
    translateAnswers = [],
    translateTimes = [],
    translateHintsUsed = [],
    translateEnteredAt = 0,
    translateIndex = 0,
    translateRun = 0,
    translateRetry = null,
    lastTranslateSettings = null;

  function flushTranslateTime() {
    if (
      translateSession &&
      translateEnteredAt > 0 &&
      translateTimes[translateIndex] != null
    ) {
      translateTimes[translateIndex] += Math.max(
        0,
        Date.now() - translateEnteredAt,
      );
    }
    translateEnteredAt = 0;
  }

  function getQuizType() {
    return document.querySelector('input[name="quiz-type"]:checked')?.value ===
      "translate"
      ? "translate"
      : "choice";
  }

  function updateQuizType() {
    const isTranslate = getQuizType() === "translate";
    const choice = document.querySelector("#quiz-choice-settings");
    const translate = document.querySelector("#quiz-translate-settings");
    const sentenceRow = document.querySelector("#quiz-sentence-row");
    if (choice) choice.hidden = isTranslate;
    if (translate) translate.hidden = !isTranslate;
    if (sentenceRow) sentenceRow.hidden = isTranslate;
    const start = document.querySelector("#quiz-start");
    if (start) start.textContent = isTranslate ? "Start AI session" : "Start quiz";
    const err = document.querySelector("#quiz-setup-error");
    if (err) err.textContent = "";
  }

  function setTranslateNotice(text) {
    if (!translateNotice) return;
    translateNotice.textContent = text || "";
    translateNotice.hidden = !text;
  }

  function renderTranslateLoading(message) {
    translateBody.innerHTML = `<div class="translate-loading"><div class="translate-spinner" aria-hidden="true"></div><p>${esc(message)}</p></div>`;
  }

  function renderTranslateError(message, retry, { canGoBack = false } = {}) {
    translateRetry = retry;
    translateBody.innerHTML = `<div class="translate-error"><p class="quiz-feedback">${esc(message)}</p><div class="translate-nav">${canGoBack ? `<button type="button" data-translate="back">← Back to answers</button>` : ""}<button type="button" class="translate-primary" data-translate="retry">Try again</button></div></div>`;
  }

  function readTranslateSettings() {
    const wordLevels = [...document.querySelectorAll(".quiz-level:checked")].map(
      (el) => el.value,
    );
    const grammarLevels = [
      ...document.querySelectorAll(".translate-grammar-level:checked"),
    ].map((el) => el.value);
    const direction =
      document.querySelector('input[name="translate-direction"]:checked')?.value ===
      "en-zh"
        ? "en-zh"
        : "zh-any";
    const count =
      parseInt(document.querySelector("#translate-count")?.value, 10) || 5;
    return { direction, wordLevels, grammarLevels, count };
  }

  function startTranslationSession() {
    const err = document.querySelector("#quiz-setup-error");
    const settings = readTranslateSettings();
    if (!settings.grammarLevels.length) {
      err.textContent = "Choose at least one grammar level to begin.";
      return;
    }
    if (!settings.wordLevels.length) {
      err.textContent = "Choose at least one word level to begin.";
      return;
    }
    err.textContent = "";
    lastTranslateSettings = settings;
    runTranslationSession(settings);
  }

  async function runTranslationSession(settings) {
    const run = ++translateRun;
    quizSetup.hidden = true;
    quizTest.hidden = true;
    quizTranslate.hidden = false;
    setTranslateNotice("");
    translateSession = null;
    translateProgress.textContent =
      settings.direction === "en-zh" ? "English → Chinese" : "Chinese → any language";
    renderTranslateLoading(`Generating ${settings.count} sentences with AI…`);
    try {
      translationModule ||= await import("./translation-quiz.mjs");
      const session = await translationModule.generateTranslationSession({
        ...settings,
        words: data,
      });
      if (run !== translateRun) return;
      translateSession = session;
      translateAnswers = session.items.map(() => "");
      translateTimes = session.items.map(() => 0);
      translateHintsUsed = session.items.map(() => false);
      translateEnteredAt = 0;
      translateIndex = 0;
      setTranslateNotice(session.notice);
      renderTranslateQuestion();
    } catch (e) {
      if (run !== translateRun) return;
      renderTranslateError(String(e?.message || e), () =>
        runTranslationSession(settings),
      );
    }
  }

  function renderTranslateQuestion() {
    const session = translateSession,
      item = session.items[translateIndex],
      total = session.items.length,
      isZh = session.direction === "zh-any",
      last = translateIndex === total - 1,
      blanks = translateAnswers.filter((a) => !a.trim()).length;
    const g = item.grammar;
    translateProgress.textContent = `${isZh ? "Chinese → any language" : "English → Chinese"} · Question ${translateIndex + 1} of ${total}`;
    const words = item.words
      .map(
        (w) =>
          `<span class="translate-word"><span lang="zh-Hans">${esc(w[0])}</span> ${esc(w[1])} · ${esc(w[3])}</span>`,
      )
      .join("");
    const dots = session.items
      .map(
        (_, i) =>
          `<button type="button" class="translate-dot${i === translateIndex ? " current" : ""}${translateAnswers[i].trim() ? " answered" : ""}" data-translate-go="${i}" aria-label="Question ${i + 1}${translateAnswers[i].trim() ? ", answered" : ""}">${i + 1}</button>`,
      )
      .join("");
    translateBody.innerHTML = `
      <p class="quiz-prompt-label">${esc(isZh ? "Translate this sentence into any language you know" : "Translate this sentence into Chinese (Hanzi)")}</p>
      <div class="quiz-prompt translate-prompt" lang="${isZh ? "zh-Hans" : "en"}">${esc(isZh ? item.hanzi : item.english)}</div>
      <div class="quiz-hints">
        ${isZh && item.pinyin ? `<button type="button" data-translate-hint="pinyin">Show pinyin</button>` : ""}
        <button type="button" data-translate-hint="grammar">Show grammar</button>
        ${!isZh ? `<button type="button" data-translate-hint="words">Show suggested words</button>` : ""}
      </div>
      ${isZh && item.pinyin ? `<p id="translate-hint-pinyin" class="quiz-meta" hidden>${esc(item.pinyin)}</p>` : ""}
      <p id="translate-hint-grammar" class="quiz-meta" hidden><span lang="zh-Hans">${esc(g.structure)}</span>${g.meaning ? ` — ${esc(g.meaning)}` : ""} (HSK ${esc(g.level)})</p>
      ${!isZh ? `<p id="translate-hint-words" class="translate-words" hidden>${words}</p>` : ""}
      <label class="translate-answer-label" for="translate-answer">Your translation</label>
      <textarea id="translate-answer" class="translate-answer" rows="3" ${isZh ? "" : 'lang="zh-Hans"'} placeholder="${isZh ? "Type your translation in any language…" : "用中文写…"}">${esc(translateAnswers[translateIndex])}</textarea>
      <div class="translate-dots" role="navigation" aria-label="Questions">${dots}</div>
      <div class="translate-nav">
        <button type="button" data-translate="prev" ${translateIndex === 0 ? "disabled" : ""}>← Previous</button>
        ${last ? "" : `<button type="button" data-translate="next">Next →</button>`}
        <button type="button" class="${last ? "translate-primary" : "translate-secondary"}" data-translate="check">Check answers${blanks ? ` (${blanks} blank)` : ""}</button>
      </div>
      <p class="quiz-meta">Answers are marked together by AI when you finish. Ctrl+Enter goes to the next question.</p>`;
    translateEnteredAt = Date.now();
    translateBody.querySelector("#translate-answer")?.focus();
  }

  function goToTranslateQuestion(index) {
    if (!translateSession) return;
    flushTranslateTime();
    translateIndex = Math.max(0, Math.min(translateSession.items.length - 1, index));
    renderTranslateQuestion();
  }

  async function checkTranslationAnswers() {
    if (!translateSession) return;
    flushTranslateTime();
    const run = ++translateRun;
    renderTranslateLoading("Checking your answers with AI…");
    try {
      const graded = await translationModule.gradeTranslationSession({
        session: translateSession,
        answers: translateAnswers,
      });
      if (run !== translateRun) return;
      const session = translateSession;
      const updates = translationModule.buildSessionProgressUpdates({
        session,
        answers: translateAnswers,
        results: graded.results,
        words: data,
        timesSeconds: translateTimes.map((ms) => ms / 1000),
        hintsUsed: translateHintsUsed,
      });
      renderTranslateResults(graded, updates);
      if (!session.progressRecorded) {
        session.progressRecorded = true;
        translationModule
          .recordSessionProgress({
            updates,
            progressStore,
            flashcardStore,
          })
          .then(({ byQuestion, totalWords }) => {
            if (translateSession === session) {
              const statusEl = translateBody.querySelector(
                "#translate-progress-status",
              );
              if (statusEl) {
                statusEl.textContent = totalWords
                  ? `Word progress saved for ${totalWords} ${totalWords === 1 ? "word" : "words"}.`
                  : "No matching HSK vocabulary words to record for this session.";
              }
              byQuestion.forEach((saved, i) => {
                if (!saved.length) return;
                const el = translateBody.querySelector(
                  `[data-translate-word-progress="${i}"]`,
                );
                if (el) {
                  const qScore = saved[0].qScore;
                  el.innerHTML = `<strong>Word progress (q=${esc(qScore)}/5):</strong> ${saved
                    .map(
                      ({ quiz }) =>
                        `<span lang="zh-Hans">${esc(quiz.word)}</span> (${quiz.correct}✓ ${quiz.incorrect}✗)`,
                    )
                    .join(" · ")}`;
                }
              });
            }
            quizDbNote.textContent =
              "Progress is saved on this device. Check Cloud sync for upload status.";
          })
          .catch(() => {
            if (translateSession === session) {
              const statusEl = translateBody.querySelector(
                "#translate-progress-status",
              );
              if (statusEl) {
                statusEl.textContent =
                  "Could not save word progress for this session.";
              }
            }
            quizDbNote.textContent =
              "Progress could not be saved in this browser.";
          });
      }
    } catch (e) {
      if (run !== translateRun) return;
      renderTranslateError(translationModule.describeAIError(e), checkTranslationAnswers, {
        canGoBack: true,
      });
    }
  }

  function renderTranslateResults({ results, summary }, updates = []) {
    const session = translateSession,
      isZh = session.direction === "zh-any";
    translateProgress.textContent = "Session complete";
    const verdictLabel = { correct: "Correct", partial: "Partly correct", incorrect: "Incorrect", ungraded: "Not marked" };
    const cards = session.items
      .map((item, i) => {
        const r = results[i],
          answer = translateAnswers[i].trim(),
          g = item.grammar,
          u = updates[i];
        const reference = isZh
          ? `${item.pinyin ? `<span lang="zh-Latn">${esc(item.pinyin)}</span> · ` : ""}${esc(item.english)}`
          : `<span lang="zh-Hans">${esc(item.hanzi)}</span>${item.pinyin ? ` · <span lang="zh-Latn">${esc(item.pinyin)}</span>` : ""}`;
        const wordLine = u?.entries?.length
          ? `<p class="quiz-meta" data-translate-word-progress="${i}"><strong>Word progress (q=${esc(u.scored.qScore)}/5):</strong> ${u.entries.map((e) => `<span lang="zh-Hans">${esc(e[0])}</span>`).join(" · ")}</p>`
          : "";
        return `<article class="translate-result verdict-${esc(r.verdict)}">
          <header><span class="translate-result-num">${i + 1}.</span><span class="translate-result-badge">${r.score ?? "–"}/100 · ${esc(verdictLabel[r.verdict] || r.verdict)}</span></header>
          <p class="translate-result-source" lang="${isZh ? "zh-Hans" : "en"}">${esc(isZh ? item.hanzi : item.english)}</p>
          <p><strong>Your answer:</strong> ${answer ? `<span ${isZh ? "" : 'lang="zh-Hans"'}>${esc(answer)}</span>` : "<em>(blank)</em>"}${r.detectedLanguage && isZh ? ` <span class="quiz-meta">(${esc(r.detectedLanguage)})</span>` : ""}</p>
          ${r.feedback ? `<p class="translate-result-feedback">${esc(r.feedback)}</p>` : ""}
          ${r.correction ? `<p><strong>${r.verdict === "correct" ? "Also good" : "Suggested"}:</strong> <span ${isZh ? "" : 'lang="zh-Hans"'}>${esc(r.correction)}</span>${r.correctionPinyin ? ` <span class="quiz-meta" lang="zh-Latn">${esc(r.correctionPinyin)}</span>` : ""}</p>` : ""}
          <p class="quiz-meta"><strong>Reference:</strong> ${reference}</p>
          <p class="quiz-meta"><strong>Grammar:</strong> <span lang="zh-Hans">${esc(g.structure)}</span>${g.meaning ? ` — ${esc(g.meaning)}` : ""} (HSK ${esc(g.level)})${item.grammarNote ? `. ${esc(item.grammarNote)}` : ""}</p>
          ${wordLine}
        </article>`;
      })
      .join("");
    const avg = summary.average === null ? "–" : summary.average;
    translateBody.innerHTML = `
      <div class="translate-summary">
        <div class="translate-summary-score">${avg}<span>/100</span></div>
        <p>${summary.correct} of ${summary.count} correct${summary.graded < summary.count ? ` · ${summary.count - summary.graded} not marked` : ""}</p>
        <p id="translate-progress-status" class="quiz-meta" role="status">Saving word progress…</p>
      </div>
      <div class="translate-results">${cards}</div>
      <div class="translate-nav">
        <button type="button" data-translate="settings">Change settings</button>
        <button type="button" class="translate-primary" data-translate="again">New session</button>
      </div>`;
    translateBody.querySelector("[data-translate='again']")?.focus();
  }

  translateBody?.addEventListener("input", (e) => {
    if (e.target?.id === "translate-answer" && translateSession) {
      translateAnswers[translateIndex] = e.target.value;
      const answered = !!e.target.value.trim();
      translateBody
        .querySelector(`[data-translate-go="${translateIndex}"]`)
        ?.classList.toggle("answered", answered);
      const check = translateBody.querySelector("[data-translate='check']");
      const blanks = translateAnswers.filter((a) => !a.trim()).length;
      if (check) check.textContent = `Check answers${blanks ? ` (${blanks} blank)` : ""}`;
    }
  });
  translateBody?.addEventListener("keydown", (e) => {
    if (e.target?.id === "translate-answer" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (translateIndex < translateSession.items.length - 1)
        goToTranslateQuestion(translateIndex + 1);
      else checkTranslationAnswers();
    }
  });
  translateBody?.addEventListener("click", (e) => {
    const hint = e.target.closest?.("[data-translate-hint]");
    if (hint) {
      const el = translateBody.querySelector("#translate-hint-" + hint.dataset.translateHint);
      if (el) {
        el.hidden = !el.hidden;
        if (!el.hidden && translateHintsUsed[translateIndex] != null) {
          translateHintsUsed[translateIndex] = true;
        }
        hint.textContent = hint.textContent.replace(/^(Show|Hide)/, el.hidden ? "Show" : "Hide");
      }
      return;
    }
    const go = e.target.closest?.("[data-translate-go]");
    if (go) return goToTranslateQuestion(+go.dataset.translateGo);
    const action = e.target.closest?.("[data-translate]")?.dataset.translate;
    if (action === "prev") goToTranslateQuestion(translateIndex - 1);
    else if (action === "next") goToTranslateQuestion(translateIndex + 1);
    else if (action === "check") checkTranslationAnswers();
    else if (action === "back") renderTranslateQuestion();
    else if (action === "retry") translateRetry?.();
    else if (action === "again" && lastTranslateSettings) runTranslationSession(lastTranslateSettings);
    else if (action === "settings") showQuizSetup();
  });
  document
    .querySelector("#translate-settings")
    ?.addEventListener("click", showQuizSetup);
  document.querySelectorAll('input[name="quiz-type"]').forEach((input) => {
    input.addEventListener("change", updateQuizType);
  });
  function openQuiz() {
    quizOverlay.hidden = false;
    document.querySelector("#quiz-open").setAttribute("aria-expanded", "true");
    showQuizSetup();
    progressStore
      .open()
      .then(() => {
        quizDbNote.textContent =
          "Progress is saved on this device. Check Cloud sync for upload status.";
      })
      .catch(() => {
        quizDbNote.textContent = "Progress could not be saved in this browser.";
      });
  }
  function closeQuiz({ notify = true } = {}) {
    quizOverlay.hidden = true;
    document.body.classList.remove("quiz-active");
    network?.redraw();
    if (isLayoutFixed()) network?.fit();
    document.querySelector("#quiz-open").setAttribute("aria-expanded", "false");
    if (notify && onClose) onClose();
    else if (notify) document.querySelector("#quiz-open").focus();
  }
  const quizLaunch = document.querySelector("#quiz-open");
  quizLaunch.onclick = null;
  if (bindLaunch) quizLaunch.addEventListener("click", openQuiz);
  if (window.__openQuizWhenReady) {
    window.__openQuizWhenReady = false;
    openQuiz();
  }
  document.querySelector("#quiz-close").addEventListener("click", closeQuiz);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !quizOverlay.hidden) closeQuiz();
  });
  document
    .querySelector("#quiz-settings")
    .addEventListener("click", showQuizSetup);
  document.querySelectorAll(".quiz-mode-option").forEach((input) => {
    input.addEventListener("change", updateModeSelection);
  });
  document.querySelectorAll(".quiz-level").forEach((input) => {
    input.addEventListener("change", updateLevelSelection);
  });
  document.querySelector("#quiz-mode-all")?.addEventListener("click", () => {
    document.querySelectorAll(".quiz-mode-option").forEach((input) => {
      input.checked = true;
    });
    updateModeSelection();
  });
  document.querySelector("#quiz-mode-clear")?.addEventListener("click", () => {
    document.querySelectorAll(".quiz-mode-option").forEach((input) => {
      input.checked = false;
    });
    updateModeSelection();
  });
  document.querySelector("#quiz-start").addEventListener("click", async () => {
    let startButton = document.querySelector("#quiz-start");
    if (getQuizType() === "translate") {
      startTranslationSession();
      return;
    }
    const modes = getSelectedModes();
    if (!modes.length) {
      document.querySelector("#quiz-setup-error").textContent =
        "Choose at least one quiz mode to begin.";
      return;
    }
    const levels = new Set(
      [...document.querySelectorAll(".quiz-level:checked")].map(
        (el) => el.value,
      ),
    );
    if (!levels.size) {
      document.querySelector("#quiz-setup-error").textContent =
        "Choose at least one word level to begin.";
      return;
    }
    if (modes.includes("sentence")) {
      startButton.disabled = true;
      document.querySelector("#quiz-setup-error").textContent =
        "Loading sentences…";
      try {
        await getSentenceCorpus();
      } catch (e) {
        document.querySelector("#quiz-setup-error").textContent =
          "Local and GitHub sources unavailable. Upload the sentence TSV.";
        startButton.disabled = false;
        return;
      }
      startButton.disabled = false;
    }
    if (quizNextQuestion()) {
      quizSetup.hidden = true;
      quizTest.hidden = false;
      quizBody.querySelector("[data-option]")?.focus();
    }
  });
  quizNext.addEventListener("click", quizNextQuestion);
  quizBody.addEventListener("click", (e) => {
    let hint = e.target.closest("[data-hint]");
    if (hint) {
      let el = quizBody.querySelector("#quiz-hint-" + hint.dataset.hint);
      el.hidden = !el.hidden;
      hint.textContent =
        (el.hidden ? "Show " : "Hide ") +
        (hint.dataset.hint === "pinyin" ? "pinyin" : "translation");
      return;
    }
    let button = e.target.closest("[data-option]");
    if (!button || !quizCurrent || button.disabled) return;
    let question = quizCurrent,
      chosen = question.options[+button.dataset.option];
    quizTotal++;
    if (chosen.correct) quizCorrect++;
    quizScore.textContent = `Score: ${quizCorrect} / ${quizTotal}`;
    quizBody.querySelectorAll("[data-option]").forEach((el) => {
      let item = question.options[+el.dataset.option];
      el.disabled = true;
      if (item.correct) el.classList.add("correct");
      el.classList?.add?.("revealed");
      const detailEl = el.querySelector?.(".quiz-option-detail");
      if (detailEl) {
        detailEl.removeAttribute?.("hidden");
        if (detailEl.style) detailEl.style.display = "";
      }
    });
    if (!chosen.correct) button.classList.add("wrong");
    const responseTime = Math.max(0, (Date.now() - questionStartTime) / 1000);
    const qQuiz = quizToQ({
      correct: chosen.correct,
      time: responseTime,
      usedHint: hintUsed,
      type: "multipleChoice",
    });
    let d = question.entry;
    const timeFormatted = `${responseTime.toFixed(1)}s`;
    quizBody.querySelector(".quiz-feedback").textContent =
      (chosen.correct ? "Correct. " : "Not quite. ") +
      (question.mode === "sentence"
        ? question.sentence[0]
        : d[0] + " · " + d[1] + " · " + d[3]) +
      ` (Score: ${qQuiz}/4 · ${timeFormatted}${hintUsed ? " · hint used" : ""})`;
    quizNext.hidden = false;
    quizNext.focus();
    quizWordProgress.textContent = "Saving word progress…";
    const entries = question.entries || [d];
    Promise.all([
      ...entries.map((entry) =>
        progressStore.record(entry, question.mode, chosen.correct, {
          qScore: qQuiz,
          time: responseTime,
          usedHint: hintUsed,
        }),
      ),
      ...entries.map((entry) =>
        flashcardStore.record(entry, qQuiz, { isQuiz: true }),
      ),
    ])
      .then((saved) => {
        if (quizCurrent === question) {
          const quizEntries = saved.slice(0, entries.length);
          quizWordProgress.textContent = quizEntries
            .map(
              (v) =>
                `${v.word}: ${v.correct} correct · ${v.incorrect} incorrect`,
            )
            .join(" | ");
        }
        quizDbNote.textContent =
          "Progress is saved on this device. Check Cloud sync for upload status.";
      })
      .catch(() => {
        if (quizCurrent === question)
          quizWordProgress.textContent = "Could not save this answer.";
        quizDbNote.textContent = "Progress could not be saved in this browser.";
      });
  });
  return { open: openQuiz, close: closeQuiz };
}
