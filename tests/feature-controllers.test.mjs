import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";

class Element extends EventTarget {
  constructor() {
    super();
    this.hidden = true;
    this.disabled = false;
    this.inert = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.dataset = {};
    const classes = new Set();
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    };
  }
  focus() {}
  setAttribute(name, value) {
    this[name] = value;
  }
  querySelectorAll() {
    return [];
  }
  querySelector() {
    return null;
  }
  showModal() {
    throw new Error("Feature routes must use regular pages");
  }
}

test("Home routes open real feature pages, start Quiz without sentence resources, and return home", async () => {
  const keys = [
    "window",
    "document",
    "location",
    "fetch",
    "BroadcastChannel",
    "requestAnimationFrame",
  ];
  const saved = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const nodes = new Map(),
    node = (id) => {
      if (!nodes.has(id)) nodes.set(id, new Element());
      return nodes.get(id);
    };
  const levels = Array.from({ length: 4 }, (_, i) => {
    const element = new Element();
    element.value = "hsk-" + (i + 1);
    return element;
  });
  const document = new EventTarget();
  document.body = new Element();
  document.hidden = false;
  document.getElementById = node;
  document.querySelector = (selector) =>
    selector.startsWith("#") ? node(selector.slice(1)) : levels[0];
  document.querySelectorAll = (selector) =>
    selector === ".quiz-level:checked"
      ? levels
      : selector.endsWith(":checked")
        ? []
        : levels;
  const window = new EventTarget();
  window.indexedDB = new IDBFactory();
  let hash = "#home";
  const location = {
    get hash() {
      return hash;
    },
    set hash(value) {
      hash = value;
      queueMicrotask(() => window.dispatchEvent(new Event("hashchange")));
    },
  };
  window.location = location;
  const requests = [];
  for (const [key, value] of Object.entries({
    window,
    document,
    location,
    BroadcastChannel: undefined,
    requestAnimationFrame: (callback) => queueMicrotask(callback),
    fetch: async (url) => {
      requests.push(String(url));
      if (!String(url).endsWith("firebase-config.json"))
        throw new Error("Unexpected optional resource request");
      return { ok: true, json: async () => ({ enabled: false }) };
    },
  }))
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  node("stats-level").value = "all";
  node("stats-filter").value = "all";
  node("stats-sort").value = "reviewed";
  node("flashcard-scope").value = "due";
  node("flashcard-limit").value = "20";
  node("quiz-mode").value = "translation";
  const waitFor = async (predicate) => {
    const end = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > end)
        throw new Error("Feature page did not finish loading");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const banner = () => {
    assert.equal(node("cloud-sync-indicator").hidden, false);
    assert.equal(node("cloud-sync-summary").textContent, "Cloud sync: off");
  };
  try {
    const { initFeatureShell } = await import("../assets/js/shell.mjs");
    const shell = initFeatureShell();
    await waitFor(
      () => node("cloud-sync-summary").textContent === "Cloud sync: off",
    );
    assert.equal(node("feature-home").hidden, false);
    assert.equal(node("feature-home-link").hidden, true);
    banner();

    shell.navigate("statistics");
    await waitFor(
      () => !node("stats-view").hidden && !node("stats-content").hidden,
    );
    assert.equal(node("feature-home").hidden, true);
    assert.equal(node("page-title").textContent, "Statistics");
    assert.equal(document.title, "Statistics | HSK Study");
    banner();
    const { ensureFeatures } = await import("../assets/js/features.mjs");
    const features = ensureFeatures();
    const originalSentences = features.ensureSentences;
    let optionalLoads = 0;
    features.ensureSentences = () => {
      optionalLoads++;
      return Promise.reject(new Error("Sentence resources unavailable"));
    };

    shell.navigate("quiz");
    await waitFor(
      () => !node("quiz-overlay").hidden && !node("quiz-overlay").inert,
    );
    assert.equal(node("stats-view").hidden, true);
    assert.equal(node("page-title").textContent, "Quiz");
    assert.equal(optionalLoads, 0);
    node("quiz-start").dispatchEvent(new Event("click"));
    await waitFor(() => node("quiz-setup").hidden && !node("quiz-test").hidden);
    assert.match(node("quiz-body").innerHTML, /Choose the English translation/);
    assert.equal(optionalLoads, 0);
    banner();
    node("quiz-close").dispatchEvent(new Event("click"));
    await waitFor(() => shell.active() === "home");
    assert.equal(node("quiz-overlay").hidden, true);
    assert.equal(node("feature-home").hidden, false);

    shell.navigate("flashcards");
    await waitFor(
      () =>
        !node("flashcard-overlay").hidden && !node("flashcard-overlay").inert,
    );
    assert.equal(node("page-title").textContent, "Flashcards");
    assert.equal(node("flashcard-start").disabled, true);
    banner();
    location.hash = "#home";
    await waitFor(() => shell.active() === "home");
    assert.equal(node("flashcard-overlay").hidden, true);

    shell.navigate("cloud");
    await waitFor(
      () => !node("cloud-dialog").hidden && !node("cloud-dialog").inert,
    );
    assert.equal(node("page-title").textContent, "Cloud sync");
    banner();

    features.wordStats.setSelected(features.data[0]);
    node("word-stats").dispatchEvent(new Event("click"));
    await waitFor(
      () => shell.active() === "statistics" && !node("stats-detail").hidden,
    );
    assert.equal(node("stats-word").textContent, features.data[0][0]);
    assert.equal(node("cloud-dialog").hidden, true);
    node("stats-back").dispatchEvent(new Event("click"));
    assert.equal(node("stats-overview").hidden, false);
    assert.equal(shell.active(), "statistics");
    shell.navigate();
    await waitFor(() => shell.active() === "home");
    assert.equal(node("stats-view").hidden, true);
    assert.equal(node("feature-home-link").hidden, true);
    assert.equal(document.title, "HSK Study");
    banner();
    assert.equal(window.vis, undefined);
    assert.ok(requests.every((url) => url.endsWith("firebase-config.json")));
    features.ensureSentences = originalSentences;
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
