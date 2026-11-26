// Story Generator UI controller and interactive comprehension quiz
import { generateStoryWithAI } from "./story-ai.mjs";

export function splitParagraphIntoSentences(p) {
  if (!p || typeof p !== "string") return [];
  const matches = p.match(/[^。！？!?\n]+[。！？!?]?["”]?/g);
  if (!matches) return [p.trim()];
  return matches.map((s) => s.trim()).filter(Boolean);
}

export function alignAllSentences(story) {
  const allParagraphSentences = [];
  if (Array.isArray(story?.paragraphs)) {
    for (const p of story.paragraphs) {
      allParagraphSentences.push(...splitParagraphIntoSentences(p));
    }
  }

  const existing = Array.isArray(story?.sentences) ? story.sentences : [];
  if (allParagraphSentences.length === 0) {
    return existing;
  }

  if (existing.length >= allParagraphSentences.length) {
    return existing;
  }

  const result = [];
  let existingIdx = 0;
  for (const sText of allParagraphSentences) {
    const cleanSText = sText.replace(/\*\*/g, "").trim();
    let match = null;

    if (existingIdx < existing.length) {
      const cand = existing[existingIdx];
      const cleanCand = (cand.hanzi || "").replace(/\*\*/g, "").trim();
      if (
        cleanCand === cleanSText ||
        cleanSText.includes(cleanCand) ||
        cleanCand.includes(cleanSText)
      ) {
        match = cand;
        existingIdx++;
      }
    }

    if (match) {
      result.push(match);
    } else {
      result.push({
        hanzi: sText,
        pinyin: "",
        english: "",
      });
    }
  }

  return result;
}

export function initStoryView() {
  const setupPage = document.getElementById("story-setup-page");
  const readerPage = document.getElementById("story-reader-page");

  const form = document.getElementById("story-form");
  const lengthInput = document.getElementById("story-length");
  const generateBtn = document.getElementById("story-generate-btn");
  const statusEl = document.getElementById("story-status");

  // Preset themes & custom theme input
  const presetRadios = document.querySelectorAll('input[name="story-theme-preset"]');
  const customThemeBox = document.getElementById("story-custom-theme-box");
  const customThemeInput = document.getElementById("story-custom-theme");

  // Nav buttons
  const backToSetupBtn = document.getElementById("story-back-to-setup");
  const generateAnotherBtn = document.getElementById("story-generate-another");

  // Reader elements
  const storyTitleEl = document.getElementById("story-title-display");
  const storySubtitleEl = document.getElementById("story-subtitle-display");
  const paragraphsContainer = document.getElementById("story-paragraphs");

  // Paginated sentence breakdown elements
  const sentencesPagination = document.getElementById("story-sentences-pagination");
  const pageCounterEl = document.getElementById("sentence-page-counter");
  const prevSentenceBtn = document.getElementById("sentence-prev-btn");
  const nextSentenceBtn = document.getElementById("sentence-next-btn");
  const activeHanziEl = document.getElementById("sentence-active-hanzi");
  const activePinyinEl = document.getElementById("sentence-active-pinyin");
  const activeEnglishEl = document.getElementById("sentence-active-english");

  // Toggles
  const togglePinyinBtn = document.getElementById("story-toggle-pinyin");
  const toggleEnglishBtn = document.getElementById("story-toggle-english");
  const toggleViewModeBtn = document.getElementById("story-toggle-viewmode");

  // Tables & Quiz
  const grammarTableBody = document.getElementById("story-grammar-rows");
  const vocabTableBody = document.getElementById("story-vocab-rows");

  const questionsContainer = document.getElementById("story-questions");
  const quizScoreEl = document.getElementById("story-quiz-score");

  // State
  let currentStory = null;
  let allSentences = [];
  let currentSentenceIndex = 0;
  let showPinyin = false; // Default: hide pinyin
  let showEnglish = false; // Default: hide translation
  let isParagraphMode = true; // Default: view as paragraphs
  let userAnswers = {};

  function updateViewMode(paragraphMode) {
    isParagraphMode = Boolean(paragraphMode);
    if (toggleViewModeBtn) {
      toggleViewModeBtn.textContent = isParagraphMode
        ? "View Sentence Breakdown"
        : "View as Paragraphs";
      toggleViewModeBtn.setAttribute("aria-pressed", String(!isParagraphMode));
    }
    if (paragraphsContainer) {
      paragraphsContainer.hidden = !isParagraphMode;
    }
    if (sentencesPagination) {
      sentencesPagination.hidden = isParagraphMode;
    }
  }

  function renderActiveSentence() {
    if (!allSentences || allSentences.length === 0) return;
    if (currentSentenceIndex < 0) currentSentenceIndex = 0;
    if (currentSentenceIndex >= allSentences.length) {
      currentSentenceIndex = allSentences.length - 1;
    }

    const sent = allSentences[currentSentenceIndex];
    if (pageCounterEl) {
      pageCounterEl.textContent = `Sentence ${currentSentenceIndex + 1} of ${allSentences.length}`;
    }
    if (prevSentenceBtn) {
      prevSentenceBtn.disabled = currentSentenceIndex === 0;
    }
    if (nextSentenceBtn) {
      nextSentenceBtn.disabled = currentSentenceIndex === allSentences.length - 1;
    }
    if (activeHanziEl) {
      activeHanziEl.innerHTML = (sent.hanzi || "").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    }
    if (activePinyinEl) {
      activePinyinEl.textContent = sent.pinyin || "";
      activePinyinEl.hidden = !showPinyin;
    }
    if (activeEnglishEl) {
      activeEnglishEl.textContent = sent.english || "";
      activeEnglishEl.hidden = !showEnglish;
    }
  }

  function nextSentence() {
    if (currentSentenceIndex < allSentences.length - 1) {
      currentSentenceIndex++;
      renderActiveSentence();
    }
  }

  function prevSentence() {
    if (currentSentenceIndex > 0) {
      currentSentenceIndex--;
      renderActiveSentence();
    }
  }

  function ensureParagraphs(story) {
    if (Array.isArray(story?.paragraphs) && story.paragraphs.length > 0) {
      return story.paragraphs;
    }
    if (Array.isArray(story?.sentences) && story.sentences.length > 0) {
      return [story.sentences.map((s) => s.hanzi).join("")];
    }
    return [];
  }

  function setStatus(msg, isError = false) {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.dataset.error = String(isError);
    }
  }

  function setLoading(loading) {
    if (generateBtn) {
      generateBtn.disabled = loading;
      generateBtn.textContent = loading ? "Generating story with AI..." : "Generate story";
    }
    if (form) {
      form.setAttribute("aria-busy", String(loading));
    }
  }

  function showSetupScreen() {
    if (setupPage) setupPage.hidden = false;
    if (readerPage) readerPage.hidden = true;
    document.getElementById("story-title")?.focus();
  }

  function showReaderScreen() {
    if (setupPage) setupPage.hidden = true;
    if (readerPage) readerPage.hidden = false;
    storyTitleEl?.focus();
    readerPage?.scrollIntoView({ behavior: "smooth" });
  }

  function renderParagraphs(paragraphs) {
    if (!paragraphsContainer) return;
    paragraphsContainer.innerHTML = "";
    for (const pText of paragraphs) {
      const p = document.createElement("p");
      p.className = "story-paragraph";
      p.setAttribute("lang", "zh-Hans");
      const html = pText.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      p.innerHTML = html;
      paragraphsContainer.appendChild(p);
    }
  }

  function renderGrammar(grammarPoints) {
    if (!grammarTableBody) return;
    grammarTableBody.innerHTML = "";
    if (!Array.isArray(grammarPoints) || grammarPoints.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="4">No specific grammar points listed.</td>';
      grammarTableBody.appendChild(tr);
      return;
    }
    for (const g of grammarPoints) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="grammar-col-struct"><strong>${escapeHtml(g.structure)}</strong></td>
        <td>${escapeHtml(g.level || "")}</td>
        <td lang="zh-Hans">${escapeHtml(g.example || "")}</td>
        <td>${escapeHtml(g.explanation || "")}</td>
      `;
      grammarTableBody.appendChild(tr);
    }
  }

  function renderVocabulary(vocabulary) {
    if (!vocabTableBody) return;
    vocabTableBody.innerHTML = "";
    if (!Array.isArray(vocabulary) || vocabulary.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="5">No vocabulary entries listed.</td>';
      vocabTableBody.appendChild(tr);
      return;
    }
    for (const v of vocabulary) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td lang="zh-Hans"><strong>${escapeHtml(v.word)}</strong></td>
        <td lang="zh-Latn">${escapeHtml(v.pinyin || "")}</td>
        <td>${escapeHtml(v.pos || "")}</td>
        <td>${escapeHtml(v.meaning || "")}</td>
        <td>${escapeHtml(v.level || "")}</td>
      `;
      vocabTableBody.appendChild(tr);
    }
  }

  function renderQuestions(questions) {
    if (!questionsContainer) return;
    questionsContainer.innerHTML = "";
    userAnswers = {};
    updateScore();

    if (!Array.isArray(questions) || questions.length === 0) {
      questionsContainer.innerHTML = "<p>No questions generated for this story.</p>";
      return;
    }

    questions.forEach((q, qIndex) => {
      const card = document.createElement("div");
      card.className = "story-quiz-card";
      card.dataset.qIndex = String(qIndex);

      const qTitle = document.createElement("h4");
      qTitle.className = "story-quiz-question";
      qTitle.textContent = `${qIndex + 1}. ${q.question}`;
      card.appendChild(qTitle);

      const optionsGrid = document.createElement("div");
      optionsGrid.className = "story-quiz-options";

      q.options.forEach((optText, optIndex) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "story-quiz-option-btn";
        btn.setAttribute("lang", "zh-Hans");
        btn.dataset.optIndex = String(optIndex);

        const prefix = String.fromCharCode(65 + optIndex);
        btn.innerHTML = `<span class="opt-prefix">${prefix}.</span> <span class="opt-text">${escapeHtml(optText)}</span>`;

        btn.addEventListener("click", () => {
          handleSelectAnswer(qIndex, optIndex, card, q);
        });

        optionsGrid.appendChild(btn);
      });
      card.appendChild(optionsGrid);

      const feedback = document.createElement("div");
      feedback.className = "story-quiz-feedback";
      feedback.hidden = true;
      card.appendChild(feedback);

      questionsContainer.appendChild(card);
    });
  }

  function handleSelectAnswer(qIndex, selectedOptIndex, card, q) {
    if (userAnswers[qIndex] !== undefined) return;
    userAnswers[qIndex] = selectedOptIndex;

    const isCorrect = selectedOptIndex === q.correctIndex;
    const optionBtns = card.querySelectorAll(".story-quiz-option-btn");

    optionBtns.forEach((btn, idx) => {
      btn.disabled = true;
      if (idx === q.correctIndex) {
        btn.classList.add("opt-correct");
      } else if (idx === selectedOptIndex && !isCorrect) {
        btn.classList.add("opt-wrong");
      }
    });

    const feedback = card.querySelector(".story-quiz-feedback");
    feedback.hidden = false;
    feedback.className = `story-quiz-feedback ${isCorrect ? "feedback-correct" : "feedback-wrong"}`;
    feedback.innerHTML = `
      <p class="feedback-title">${isCorrect ? "✓ Correct!" : "✗ Not quite."}</p>
      <p class="feedback-exp">${escapeHtml(q.explanation || "")}</p>
    `;

    updateScore();
  }

  function updateScore() {
    if (!quizScoreEl) return;
    if (!currentStory?.questions?.length) {
      quizScoreEl.textContent = "";
      return;
    }
    const total = currentStory.questions.length;
    const answeredCount = Object.keys(userAnswers).length;
    if (answeredCount === 0) {
      quizScoreEl.textContent = `0 of ${total} answered`;
      return;
    }
    let correctCount = 0;
    for (const [qIdx, ansIdx] of Object.entries(userAnswers)) {
      if (currentStory.questions[qIdx]?.correctIndex === ansIdx) {
        correctCount++;
      }
    }
    quizScoreEl.textContent = `${correctCount} of ${answeredCount} correct (${total} total questions)`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getSelectedLevels() {
    const checked = Array.from(
      document.querySelectorAll('input[name="story-level"]:checked'),
    ).map((cb) => cb.value);
    return checked.length > 0 ? checked : ["HSK 1"];
  }

  function getSelectedTheme() {
    const checkedPreset = document.querySelector('input[name="story-theme-preset"]:checked');
    const val = checkedPreset ? checkedPreset.value : "random";
    if (val === "custom") {
      return customThemeInput?.value.trim() || "";
    }
    if (val === "random") {
      return "";
    }
    return val;
  }

  async function handleGenerate(e) {
    if (e) e.preventDefault();
    const levels = getSelectedLevels();
    const numChars = parseInt(lengthInput?.value || "300", 10);
    const targetLength = `${Number.isFinite(numChars) && numChars > 0 ? numChars : 300} characters`;
    const theme = getSelectedTheme();

    setLoading(true);
    setStatus("Generating level-locked story and comprehension questions with AI...");

    try {
      const story = await generateStoryWithAI({
        level: levels,
        targetLength,
        theme,
      });

      currentStory = story;
      if (storyTitleEl) storyTitleEl.textContent = story.title;
      if (storySubtitleEl) {
        storySubtitleEl.textContent = `${story.pinyinTitle || ""} — ${story.englishTitle || ""}`;
      }

      const paragraphs = ensureParagraphs(story);
      allSentences = alignAllSentences(story);
      currentSentenceIndex = 0;

      renderParagraphs(paragraphs);
      renderActiveSentence();
      renderGrammar(story.grammarPoints || []);
      renderVocabulary(story.vocabulary || []);
      renderQuestions(story.questions || []);

      // Default: View as paragraphs, hide pinyin, hide translation
      showPinyin = false;
      showEnglish = false;
      if (togglePinyinBtn) {
        togglePinyinBtn.setAttribute("aria-pressed", "false");
        togglePinyinBtn.textContent = "Show Pinyin";
      }
      if (toggleEnglishBtn) {
        toggleEnglishBtn.setAttribute("aria-pressed", "false");
        toggleEnglishBtn.textContent = "Show Translation";
      }

      updateViewMode(true); // Default to paragraph view
      if (story.aiNotice?.error) {
        setStatus(story.aiNotice.error, Boolean(story.aiNotice.isUnauthorized));
      } else {
        setStatus("Story generated successfully!");
      }
      showReaderScreen();
    } catch (err) {
      console.error("Story generation failed:", err);
      setStatus("Could not generate story. Please check your connection and try again.", true);
    } finally {
      setLoading(false);
    }
  }

  // Handle Preset selection toggling custom input
  presetRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (customThemeBox) {
        const isCustom = radio.value === "custom";
        customThemeBox.hidden = !isCustom;
        if (isCustom && customThemeInput) {
          customThemeInput.focus();
        }
      }
    });
  });

  if (form) {
    form.addEventListener("submit", handleGenerate);
  }

  if (backToSetupBtn) {
    backToSetupBtn.addEventListener("click", showSetupScreen);
  }

  if (generateAnotherBtn) {
    generateAnotherBtn.addEventListener("click", showSetupScreen);
  }

  if (prevSentenceBtn) {
    prevSentenceBtn.addEventListener("click", prevSentence);
  }

  if (nextSentenceBtn) {
    nextSentenceBtn.addEventListener("click", nextSentence);
  }

  if (togglePinyinBtn) {
    togglePinyinBtn.addEventListener("click", () => {
      showPinyin = !showPinyin;
      togglePinyinBtn.setAttribute("aria-pressed", String(showPinyin));
      togglePinyinBtn.textContent = showPinyin ? "Hide Pinyin" : "Show Pinyin";
      if (activePinyinEl) {
        activePinyinEl.hidden = !showPinyin;
      }
    });
  }

  if (toggleEnglishBtn) {
    toggleEnglishBtn.addEventListener("click", () => {
      showEnglish = !showEnglish;
      toggleEnglishBtn.setAttribute("aria-pressed", String(showEnglish));
      toggleEnglishBtn.textContent = showEnglish ? "Hide Translation" : "Show Translation";
      if (activeEnglishEl) {
        activeEnglishEl.hidden = !showEnglish;
      }
    });
  }

  if (toggleViewModeBtn) {
    toggleViewModeBtn.addEventListener("click", () => {
      updateViewMode(!isParagraphMode);
    });
  }

  // Keyboard navigation for sentence pagination
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("keydown", (e) => {
      if (!isParagraphMode && !sentencesPagination?.hidden) {
        if (e.key === "ArrowLeft") {
          prevSentence();
        } else if (e.key === "ArrowRight") {
          nextSentence();
        }
      }
    });
  }

  return {
    generate: handleGenerate,
    showSetupScreen,
    showReaderScreen,
    updateViewMode,
    nextSentence,
    prevSentence,
    getCurrentSentenceIndex: () => currentSentenceIndex,
    isParagraphMode: () => isParagraphMode,
    getSelectedLevels,
    getSelectedTheme,
    getCurrentStory: () => currentStory,
    getUserAnswers: () => userAnswers,
  };
}
