import {
  parseGrammarTSV,
  filterGrammar,
  grammarCounts,
} from "./grammar-model.mjs";
import { createSpeechPlayer } from "./audio.mjs";
import { esc } from "./utils.mjs";

export function initGrammarExplorer() {
  const el = (id) => document.getElementById("grammar-" + id);
  const speech = createSpeechPlayer();
  let entries = null,
    loading = null,
    page = 0,
    selected = null;
  const pageSize = 30;
  function closeDetail() {
    selected = null;
    speech.stopSpeech();
    el("view").classList.remove("grammar-detail-open");
    el("detail").hidden = true;
    el("placeholder").hidden = false;
  }
  function select(id) {
    const entry = entries?.find((row) => row.id === id);
    if (!entry) return;
    selected = entry;
    speech.stopSpeech();
    el("structure").textContent =
      entry.structure || entry.meaning || `Grammar ${entry.code}`;
    el("structure").lang = entry.structure ? "zh-Hans" : "en";
    el("meta").textContent = `HSK ${entry.level} | ${entry.code}`;
    el("pinyin").textContent = entry.pinyin;
    el("pinyin").hidden = !entry.pinyin;
    el("meaning").textContent =
      entry.meaning || "No English equivalent supplied.";
    el("example").textContent = entry.example || "No example supplied.";
    el("example-pinyin").textContent = entry.examplePinyin;
    el("translation").textContent = entry.translation;
    el("speech").textContent = "";
    el("speak").disabled = !entry.example;
    el("detail").hidden = false;
    el("placeholder").hidden = true;
    el("list")
      .querySelectorAll("[data-grammar-id]")
      .forEach((button) =>
        button.setAttribute(
          "aria-current",
          String(Number(button.dataset.grammarId) === id),
        ),
      );
    el("view").classList.add("grammar-detail-open");
    el("structure").focus();
  }
  function render() {
    if (!entries) return;
    const filtered = filterGrammar(entries, {
      query: el("search").value,
      level: el("level").value,
    });
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, pages - 1);
    el("count").textContent =
      `${filtered.length} of ${entries.length} grammar entries`;
    el("list").innerHTML =
      filtered
        .slice(page * pageSize, (page + 1) * pageSize)
        .map(
          (entry) =>
            `<button class="grammar-item" type="button" data-grammar-id="${entry.id}" aria-current="${selected?.id === entry.id}"><span class="grammar-item-meta">HSK ${entry.level} | ${esc(entry.code)}</span><strong lang="zh-Hans">${esc(entry.structure || entry.meaning || `Grammar ${entry.code}`)}</strong><span>${esc(entry.pinyin)}</span><span class="grammar-item-meaning">${esc(entry.meaning)}</span></button>`,
        )
        .join("") ||
      '<p class="grammar-empty">No grammar matches. Try another level or search term.</p>';
    el("page").textContent = `Page ${page + 1} of ${pages}`;
    el("previous").disabled = page === 0;
    el("next").disabled = page + 1 >= pages;
    if (selected && !filtered.some((entry) => entry.id === selected.id))
      closeDetail();
  }
  async function activate() {
    if (entries) {
      render();
      return;
    }
    if (loading) return loading;
    el("status").textContent = "Loading grammar entries...";
    el("retry").hidden = true;
    loading = (async () => {
      try {
        const response = await fetch(
          new URL("../../data/hsk-1-6-grammar.tsv", import.meta.url),
        );
        if (!response.ok) throw new Error("Grammar TSV unavailable");
        entries = parseGrammarTSV(await response.text());
        const counts = grammarCounts(entries);
        for (const option of el("level").options) {
          if (option.value !== "all")
            option.textContent = `HSK ${option.value} (${counts[option.value]})`;
        }
        el("status").textContent =
          "Choose a grammar pattern to see its explanation and example.";
        el("controls").hidden = false;
        render();
      } catch (error) {
        el("status").textContent =
          "Could not load the grammar file. Check your connection and try again.";
        el("retry").hidden = false;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
  for (const id of ["search", "level"])
    el(id).addEventListener(id === "search" ? "input" : "change", () => {
      page = 0;
      render();
    });
  el("list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-grammar-id]");
    if (button) select(Number(button.dataset.grammarId));
  });
  el("back").addEventListener("click", () => {
    closeDetail();
    el("search").focus();
  });
  el("previous").addEventListener("click", () => {
    page--;
    render();
    el("list").scrollTop = 0;
  });
  el("next").addEventListener("click", () => {
    page++;
    render();
    el("list").scrollTop = 0;
  });
  el("retry").addEventListener("click", activate);
  el("speak").addEventListener("click", () => {
    if (selected?.example) speech.playSpeech(selected.example, el("speech"));
  });
  return { activate, deactivate: () => speech.stopSpeech() };
}
