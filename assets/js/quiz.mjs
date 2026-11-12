import { esc } from "./utils.mjs";
import { createWordProgressStore } from "./progress.mjs";

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
      let options = [{ id, text: correct, correct: true }];
      for (const item of distractors) {
        let value = answer(data[item.j], mode),
          key = value.toLocaleLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          options.push({ id: item.j, text: value, correct: false });
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
  data.forEach((d) => {
    if (!readingCounts.has(d[0])) readingCounts.set(d[0], new Set());
    readingCounts.get(d[0]).add(d[1].toLowerCase().trim());
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
            variants.map((v, i) => ({ text: v.join(" / "), correct: i === 0 })),
          ),
        };
      }
    }
    return null;
  }
  return { question, pinyinHint };
}

export function initQuiz({
  data,
  neighborSets,
  localSentenceData,
  cloudReady,
  getSentenceCorpus,
  network,
  isLayoutFixed,
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
  const progressStore = createWordProgressStore(window.indexedDB, cloudReady);
  let quizCurrent = null,
    quizLast = -1,
    quizCorrect = 0,
    quizTotal = 0;
  function quizNextQuestion() {
    let levels = new Set(
      [...document.querySelectorAll(".quiz-level:checked")].map(
        (el) => el.value,
      ),
    );
    let eligible = data.map((_, i) => i).filter((i) => levels.has(data[i][4]));
    let mode = quizMode.value;
    if (mode === "mix")
      mode = ["translation", "character", "pinyin", "sentence"][
        Math.floor(Math.random() * 4)
      ];
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
    quizBody.innerHTML = `<p class="quiz-prompt-label">${label}</p><div class="quiz-prompt">${esc(question.prompt)}</div>${hints}<div class="quiz-options">${question.options.map((o, i) => `<button type="button" class="quiz-option" data-option="${i}">${esc(o.text)}</button>`).join("")}</div><p class="quiz-feedback" aria-live="polite"></p>`;
    return true;
  }
  window.addEventListener("hsk-progress-changed", (e) => {
    if (e.detail?.accountChanged && !quizOverlay.hidden) showQuizSetup();
  });
  function showQuizSetup() {
    quizSetup.hidden = false;
    quizTest.hidden = true;
    quizCurrent = null;
    quizLast = -1;
    quizCorrect = quizTotal = 0;
    quizScore.textContent = "Score: 0 / 0";
    document.querySelector("#quiz-setup-error").textContent = "";
    quizMode.focus();
  }
  function openQuiz() {
    document.body.classList.add("quiz-active");
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
  function closeQuiz() {
    quizOverlay.hidden = true;
    document.body.classList.remove("quiz-active");
    network.redraw();
    if (isLayoutFixed()) network.fit();
    document.querySelector("#quiz-open").setAttribute("aria-expanded", "false");
    document.querySelector("#quiz-open").focus();
  }
  const quizLaunch = document.querySelector("#quiz-open");
  quizLaunch.onclick = null;
  quizLaunch.addEventListener("click", openQuiz);
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
  document.querySelector("#quiz-start").addEventListener("click", async () => {
    let startButton = document.querySelector("#quiz-start");
    if (quizMode.value === "sentence" || quizMode.value === "mix") {
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
    });
    if (!chosen.correct) button.classList.add("wrong");
    let d = question.entry;
    quizBody.querySelector(".quiz-feedback").textContent =
      (chosen.correct ? "Correct. " : "Not quite. ") +
      (question.mode === "sentence"
        ? question.sentence[0]
        : d[0] + " · " + d[1] + " · " + d[3]);
    quizNext.hidden = false;
    quizNext.focus();
    quizWordProgress.textContent = "Saving word progress…";
    Promise.all(
      (question.entries || [d]).map((entry) =>
        progressStore.record(entry, question.mode, chosen.correct),
      ),
    )
      .then((saved) => {
        if (quizCurrent === question)
          quizWordProgress.textContent = saved
            .map(
              (v) =>
                `${v.word}: ${v.correct} correct · ${v.incorrect} incorrect`,
            )
            .join(" | ");
        quizDbNote.textContent =
          "Progress is saved on this device. Check Cloud sync for upload status.";
      })
      .catch(() => {
        if (quizCurrent === question)
          quizWordProgress.textContent = "Could not save this answer.";
        quizDbNote.textContent = "Progress could not be saved in this browser.";
      });
  });
}
