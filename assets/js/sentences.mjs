import { esc } from "./utils.mjs";

export function parseTSVLine(line) {
  let fields = [],
    field = "",
    quoted = false,
    begin = true;
  for (let i = 0; i < line.length; i++) {
    let ch = line[i];
    if (begin && ch === '"') {
      quoted = true;
      begin = false;
      continue;
    }
    begin = false;
    if (quoted && ch === '"') {
      if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === "\t" && !quoted) {
      fields.push(field);
      field = "";
      begin = true;
    } else field += ch;
  }
  fields.push(field);
  return fields;
}
export function readIndexedSentences(text, byWord) {
  let wanted = new Set(Object.values(byWord).flat()),
    rows = {},
    remaining = wanted.size;
  for (let line of text.split(/\r?\n/)) {
    let tab = line.indexOf("\t");
    if (tab < 0) continue;
    let id = Number(line.slice(0, tab));
    if (!wanted.has(id) || Object.hasOwn(rows, id)) continue;
    let fields = parseTSVLine(line);
    if (fields.length < 5) continue;
    rows[id] = [
      fields[1].trim(),
      fields[3].trim(),
      fields.slice(4).join(" ").trim(),
    ];
    remaining--;
    if (!remaining) break;
  }
  if (remaining)
    throw Error(
      "The selected TSV does not match this sentence index (" +
        remaining +
        " entries missing).",
    );
  return rows;
}

export function initSentenceExamples({
  data,
  localSentenceData,
  getSelected,
  playSpeech,
}) {
  const examplesButton = document.querySelector("#examples-button"),
    examplesPanel = document.querySelector("#examples-panel"),
    examplesContent = document.querySelector("#examples-content"),
    examplesTitle = document.querySelector("#examples-title");
  let requestNumber = 0,
    sentenceLoading = null;
  const sentenceCache = new Map(),
    sentenceFile = document.querySelector("#sentence-file"),
    sentenceFileStatus = document.querySelector("#sentence-file-status"),
    chooseSentenceFile = document.querySelector("#choose-sentence-file");
  async function useSentenceText(text) {
    const rows = readIndexedSentences(text, localSentenceData.byWord);
    localSentenceData.sentences = rows;
    sentenceCache.clear();
    sentenceFileStatus.textContent = "Sentence TSV loaded.";
    chooseSentenceFile.hidden = true;
    return rows;
  }
  function getSentenceCorpus() {
    if (localSentenceData.sentences)
      return Promise.resolve(localSentenceData.sentences);
    if (sentenceLoading) return sentenceLoading;
    sentenceLoading = (async () => {
      const sources = [
        "./data/cmn_sen_db_2.tsv",
        "https://raw.githubusercontent.com/krmanik/Chinese-Example-Sentences/main/Chinese%20Example%20Sentences/cmn_sen_db_2.tsv",
      ];
      for (const url of sources) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          return await useSentenceText(await response.text());
        } catch (e) {}
      }
      chooseSentenceFile.hidden = false;
      sentenceFileStatus.textContent =
        "Local and GitHub sources unavailable. Upload the sentence TSV.";
      throw Error("Sentence TSV unavailable");
    })().finally(() => {
      sentenceLoading = null;
    });
    return sentenceLoading;
  }
  chooseSentenceFile.addEventListener("click", () => sentenceFile.click());
  sentenceFile.addEventListener("change", async () => {
    let file = sentenceFile.files[0];
    if (!file) return;
    sentenceFileStatus.textContent = "Loading sentence TSV…";
    try {
      await useSentenceText(await file.text());
      document.querySelector("#quiz-setup-error").textContent = "";
      if (!examplesPanel.hidden && getSelected() >= 0) showExamples();
    } catch (e) {
      chooseSentenceFile.hidden = false;
      sentenceFileStatus.textContent =
        "Could not use this file. Upload the original cmn_sen_db_2.tsv.";
    }
    sentenceFile.value = "";
  });
  async function showExamples() {
    if (getSelected() < 0) return;
    let id = getSelected(),
      word = data[id][0],
      request = ++requestNumber;
    examplesTitle.textContent = "Examples · " + word;
    examplesContent.innerHTML =
      '<p class="example-status">Loading sentences…</p>';
    try {
      await getSentenceCorpus();
      if (
        request !== requestNumber ||
        getSelected() !== id ||
        examplesPanel.hidden
      )
        return;
      let matches = (localSentenceData.byWord[word] || [])
        .slice(0, 5)
        .map((i) => {
          let row = localSentenceData.sentences[i];
          return { zh: row[0], pinyin: row[1], en: row[2] };
        });
      sentenceCache.set(word, matches);
      examplesContent.innerHTML = matches.length
        ? matches
            .map(
              (r, i) =>
                `<article class="example-card"><div class="example-zh">${esc(r.zh)}</div><div class="example-pinyin">${esc(r.pinyin)}</div><div class="example-en">${esc(r.en)}</div><button type="button" data-example="${i}">🔊 Play sentence</button> <span class="example-status" aria-live="polite"></span></article>`,
            )
            .join("") +
          (matches.length < 5
            ? `<p class="example-status">Only ${matches.length} matching sentences were found in the supplied file.</p>`
            : "")
        : '<p class="example-status">No matching sentences were found in the supplied file.</p>';
    } catch (e) {
      if (request === requestNumber && !examplesPanel.hidden)
        examplesContent.innerHTML =
          '<p class="example-status">Local and GitHub sentence sources are unavailable. Upload the sentence TSV.</p><button class="example-file-button" type="button" data-load-sentences>Upload sentence TSV</button>';
    }
  }
  examplesButton.addEventListener("click", () => {
    if (getSelected() < 0) return;
    examplesPanel.hidden = !examplesPanel.hidden;
    examplesButton.setAttribute("aria-expanded", String(!examplesPanel.hidden));
    if (!examplesPanel.hidden) showExamples();
  });
  document.querySelector("#close-examples").addEventListener("click", () => {
    examplesPanel.hidden = true;
    examplesButton.setAttribute("aria-expanded", "false");
    requestNumber++;
  });
  examplesContent.addEventListener("click", (e) => {
    if (e.target.closest("[data-load-sentences]")) {
      sentenceFile.click();
      return;
    }
    let button = e.target.closest("[data-example]");
    if (!button || getSelected() < 0) return;
    let rows = sentenceCache.get(data[getSelected()][0]) || [],
      row = rows[+button.dataset.example];
    if (row) playSpeech(row.zh, button.nextElementSibling);
  });

  function invalidateExamples() {
    requestNumber++;
  }
  return {
    examplesButton,
    examplesPanel,
    showExamples,
    getSentenceCorpus,
    invalidateExamples,
  };
}
