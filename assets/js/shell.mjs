import { ensureCloudSync } from "./cloud-service.mjs";

export const FEATURES = [
  "explorer",
  "statistics",
  "flashcards",
  "quiz",
  "cloud",
  "grammar",
  "story",
];
export const PAGE_NAMES = {
  home: "HSK Study",
  explorer: "Word explorer",
  statistics: "Statistics",
  flashcards: "Flashcards",
  quiz: "Quiz",
  cloud: "Cloud sync",
  grammar: "Grammar explorer",
  story: "AI Story generator",
};
export function featureFromHash(hash) {
  const value = hash.replace(/^#\/?/, "").toLowerCase();
  return FEATURES.includes(value) ? value : "home";
}

export function initFeatureShell() {
  const views = Object.fromEntries(
    Object.entries({
      home: "feature-home",
      explorer: "word-view",
      statistics: "stats-view",
      flashcards: "flashcard-overlay",
      quiz: "quiz-overlay",
      cloud: "cloud-dialog",
      grammar: "grammar-view",
      story: "story-view",
    }).map(([name, id]) => [name, document.getElementById(id)]),
  );
  const status = document.getElementById("feature-status");
  const title = document.getElementById("page-title");
  let active = "home",
    generation = 0,
    common,
    commonPromise,
    quiz,
    grammar,
    storyController,
    pendingStatsEntry = null;
  let explorerStarted = false,
    explorerController,
    vendorPromise;
  const cloudReady = ensureCloudSync();
  function navigate(feature = "home", entry = null) {
    pendingStatsEntry = feature === "statistics" ? entry : null;
    const hash = feature === "home" ? "#home" : "#" + feature;
    if (location.hash === hash) render();
    else location.hash = hash;
  }
  function ensureCommon() {
    if (!commonPromise)
      commonPromise = import("./features.mjs")
        .then((module) => {
          common = module.ensureFeatures({
            onHome: () => navigate(),
            onStatistics: (entry) => navigate("statistics", entry),
          });
          return common;
        })
        .catch((error) => {
          commonPromise = null;
          throw error;
        });
    return commonPromise;
  }
  function loadVendor() {
    if (window.vis) return Promise.resolve();
    if (!vendorPromise)
      vendorPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL(
          "../vendor/vis-network.min.js",
          import.meta.url,
        ).href;
        script.onload = () =>
          window.vis
            ? resolve()
            : reject(new Error("Network library unavailable"));
        script.onerror = () => {
          script.remove();
          vendorPromise = null;
          reject(new Error("Network library could not load"));
        };
        document.head.append(script);
      });
    return vendorPromise;
  }
  async function render() {
    const token = ++generation,
      feature = featureFromHash(location.hash);
    active = feature;
    window.dispatchEvent(new Event("hsk-feature-leaving"));
    common?.stopSpeech();
    grammar?.deactivate();
    common?.flashcards.close({ force: true, notify: false });
    common?.wordStats.close();
    quiz?.close({ notify: false });
    document.body.classList.remove("quiz-active");
    document.body.classList.remove("flashcard-active");
    for (const [name, view] of Object.entries(views)) {
      view.hidden = name !== feature;
      view.inert = name === feature && feature !== "home";
      view.setAttribute(
        "aria-busy",
        String(name === feature && feature !== "home"),
      );
    }
    document.body.dataset.feature = feature;
    title.textContent = PAGE_NAMES[feature];
    document.title =
      feature === "home" ? "HSK Study" : `${PAGE_NAMES[feature]} | HSK Study`;
    document.getElementById("feature-home-link").hidden = feature === "home";
    document.getElementById("page-description").textContent =
      feature === "home" ? "Choose a study feature to get started." : "";
    status.textContent = "";
    function ready() {
      if (token !== generation) return false;
      views[feature].inert = false;
      views[feature].setAttribute("aria-busy", "false");
      status.textContent = "";
      return true;
    }
    if (feature === "home") {
      document.getElementById("feature-heading").focus();
      return;
    }
    status.textContent = `Opening ${PAGE_NAMES[feature].toLowerCase()}...`;
    try {
      if (feature === "cloud") {
        const controller = await cloudReady;
        if (!ready()) return;
        controller?.open();
      } else if (feature === "grammar") {
        if (!grammar) {
          const module = await import("./grammar.mjs");
          if (token !== generation) return;
          grammar = module.initGrammarExplorer();
        }
        await grammar.activate();
        if (!ready()) return;
      } else if (feature === "story") {
        if (!storyController) {
          const module = await import("./story.mjs");
          if (token !== generation) return;
          storyController = module.initStoryView();
        }
        if (!ready()) return;
      } else {
        const shared = await ensureCommon();
        if (token !== generation) return;
        if (feature === "explorer") {
          if (!explorerStarted) {
            const [module, mobile, relations, source] = await Promise.all([
              import("./app.mjs"),
              import("./mobile.mjs"),
              shared.ensureRelationships(),
              shared.ensureSentences(),
              loadVendor(),
            ]);
            if (!ready()) return;
            mobile.initMobileLayout();
            explorerStarted = true;
            module.startApp({
              features: shared,
              relations,
              source,
              onReady(controller) {
                explorerController = controller;
                if (active === "explorer")
                  requestAnimationFrame(() => controller.redraw());
              },
              onError(error) {
                if (active === "explorer")
                  status.textContent =
                    "Could not start the word explorer. Refresh the page to retry.";
                console.error(error);
              },
            });
          } else {
            if (!ready()) return;
            requestAnimationFrame(() => explorerController?.redraw());
          }
        } else if (feature === "statistics") {
          if (!ready()) return;
          shared.wordStats.open(pendingStatsEntry);
          pendingStatsEntry = null;
        } else if (feature === "flashcards") {
          if (!ready()) return;
          shared.flashcards.open();
        } else if (feature === "quiz") {
          quiz = await shared.ensureQuiz();
          if (!ready()) return;
          quiz.open();
        }
      }
      if (token === generation) title.focus();
    } catch (error) {
      if (token !== generation) return;
      status.textContent = `Could not open ${PAGE_NAMES[feature].toLowerCase()}. Return home and try again, or refresh the page.`;
      console.error(error);
    }
  }
  for (const [id, feature] of Object.entries({
    "stats-open": "statistics",
    "flashcard-open": "flashcards",
    "quiz-open": "quiz",
    "cloud-open": "cloud",
    "story-open": "story",
  })) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = false;
    button.addEventListener("click", () => navigate(feature));
  }
  views.home.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-feature]");
    if (link && location.hash === link.getAttribute("href")) {
      event.preventDefault();
      render();
    }
  });
  window.addEventListener("hashchange", render);
  render();
  return { navigate, active: () => active };
}
