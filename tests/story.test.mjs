import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildStoryPrompt,
  extractJSONFromResponse,
  validateStoryOutput,
  generateCuratedStory,
  normalizeLevel,
  initializeFirebaseServices,
  generateStoryWithAI,
  getAuthToken,
} from "../assets/js/story-ai.mjs";
import { FEATURES, PAGE_NAMES, featureFromHash } from "../assets/js/shell.mjs";

test("shell routes register the story feature and HTML exposes its navigation card", () => {
  assert.ok(FEATURES.includes("story"), "FEATURES must include 'story'");
  assert.equal(PAGE_NAMES.story, "AI Story generator");
  assert.equal(featureFromHash("#story"), "story");
  assert.equal(featureFromHash("#/STORY"), "story");

  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /href="#story"/);
  assert.match(html, /id="story-view"/);
  assert.match(html, /assets\/css\/story\.css/);
  assert.match(html, /recaptcha\/enterprise\.js\?render=6LftcDMuAAAAAN94wgFGS7gdcEhYbLdvudj_3USN/);

  // Specifications verification:
  // 1. Multi-select checkboxes for HSK level
  assert.match(html, /input\s+type="checkbox"\s+name="story-level"/);
  // 2. Number field for target length
  assert.match(html, /input[^>]+id="story-length"[^>]+type="number"/);
  // 3. Preset themes + custom / random
  assert.match(html, /input\s+type="radio"\s+name="story-theme-preset"/);
  assert.match(html, /id="story-custom-theme"/);
  // 4. Two-page structure (setup vs reader)
  assert.match(html, /id="story-setup-page"/);
  assert.match(html, /id="story-reader-page"/);
  assert.match(html, /id="story-back-to-setup"/);
  // 5. Left-right sentence pagination with mobile-first controls
  assert.match(html, /id="story-sentences-pagination"/);
  assert.match(html, /id="sentence-prev-btn"/);
  assert.match(html, /id="sentence-next-btn"/);
  assert.match(html, /id="sentence-page-counter"/);
  assert.match(html, /id="sentence-active-card"/);
  // 6. Toggles default to Show Pinyin, Show Translation, View Sentence Breakdown
  assert.match(html, /id="story-toggle-pinyin"[^>]*>[\s\n]*Show Pinyin/);
  assert.match(html, /id="story-toggle-english"[^>]*>[\s\n]*Show Translation/);
  assert.match(html, /id="story-toggle-viewmode"[^>]*>[\s\n]*View Sentence Breakdown/);
});

test("normalizeLevel handles HSK single levels and multi-select combined levels", () => {
  assert.deepEqual(normalizeLevel("HSK 1"), { name: "HSK 1", levels: [1] });
  assert.deepEqual(normalizeLevel("hsk 2"), { name: "HSK 2", levels: [2] });
  assert.deepEqual(normalizeLevel("HSK 1 and 2"), { name: "HSK 1 and 2", levels: [1, 2] });
  assert.deepEqual(normalizeLevel("hsk-3"), { name: "HSK 3", levels: [3] });

  // Multi-select array tests
  assert.deepEqual(normalizeLevel(["HSK 1"]), { name: "HSK 1", levels: [1] });
  assert.deepEqual(normalizeLevel(["HSK 1", "HSK 2"]), { name: "HSK 1 and 2", levels: [1, 2] });
  assert.deepEqual(normalizeLevel(["HSK 2", "HSK 3"]), { name: "HSK 2 and 3", levels: [2, 3] });
  assert.deepEqual(normalizeLevel(["HSK 1", "HSK 2", "HSK 3"]), { name: "HSK 1 to 3", levels: [1, 2, 3] });
  assert.deepEqual(normalizeLevel([]), { name: "HSK 1", levels: [1] });
});

test("buildStoryPrompt includes level constraints, grammar patterns, and question specs", () => {
  const sampleGrammar = [
    { level: 1, structure: "想 + 动词", meaning: "want to", example: "我想看书" },
    { level: 1, structure: "去 PLACE V", meaning: "go to place to do V", example: "我去学校学习" },
    { level: 2, structure: "因为...所以...", meaning: "because... so...", example: "因为下雨所以不去了" },
  ];

  const prompt = buildStoryPrompt({
    level: "HSK 1",
    targetLength: "300 characters",
    theme: "Shopping for apples",
    grammarEntries: sampleGrammar,
  });

  assert.match(prompt, /Target Level: HSK 1/);
  assert.match(prompt, /Target Length: 300 characters/);
  assert.match(prompt, /Story Theme: Shopping for apples/);
  assert.match(prompt, /想 \+ 动词/);
  assert.match(prompt, /去 PLACE V/);
  assert.doesNotMatch(prompt, /因为\.\.\.所以\.\.\./);
  assert.match(prompt, /Each question MUST be in English/i);
  assert.match(prompt, /MUST have 3 or 4 answer options written in Hanzi/i);
});

test("extractJSONFromResponse handles clean JSON, codeblock fences, and surrounding whitespace", () => {
  const clean = '{"title":"Test","paragraphs":["P1"],"questions":[{"question":"Q?","options":["A","B","C"],"correctIndex":0}]}';
  assert.equal(extractJSONFromResponse(clean).title, "Test");

  const fenced = `\`\`\`json\n${clean}\n\`\`\``;
  assert.equal(extractJSONFromResponse(fenced).title, "Test");

  const withCommentary = `Here is your story:\n\`\`\`\n${clean}\n\`\`\`\nEnjoy!`;
  assert.equal(extractJSONFromResponse(withCommentary).title, "Test");

  assert.throws(() => extractJSONFromResponse("No json here"), /No JSON structure found/);
  assert.throws(() => extractJSONFromResponse(""), /Empty response/);
});

test("validateStoryOutput enforces required story fields and question specifications", () => {
  const valid = {
    title: "星期天",
    paragraphs: ["段落一"],
    questions: [
      { question: "Where did they go?", options: ["商店", "饭店", "学校"], correctIndex: 1 },
      { question: "What did they eat?", options: ["包子", "米饭", "面条儿", "饺子"], correctIndex: 0 },
    ],
  };

  const checked = validateStoryOutput(valid);
  assert.equal(checked.title, "星期天");
  assert.equal(checked.questions.length, 2);

  // Missing title
  assert.throws(() => validateStoryOutput({ paragraphs: ["P"], questions: [{}, {}] }), /title/);

  // Missing paragraphs
  assert.throws(() => validateStoryOutput({ title: "T", paragraphs: [], questions: [{}, {}] }), /paragraph/);

  // Fewer than 2 questions
  assert.throws(() => validateStoryOutput({ title: "T", paragraphs: ["P"], questions: [{}] }), /questions/);

  // Question missing English prompt or options
  assert.throws(
    () =>
      validateStoryOutput({
        title: "T",
        paragraphs: ["P"],
        questions: [{ question: "", options: ["A", "B", "C"] }, { question: "Q2", options: ["A", "B", "C"] }],
      }),
    /English question string/,
  );

  // Question with fewer than 3 options
  assert.throws(
    () =>
      validateStoryOutput({
        title: "T",
        paragraphs: ["P"],
        questions: [{ question: "Q1", options: ["A", "B"] }, { question: "Q2", options: ["A", "B", "C"] }],
      }),
    /3 or 4 answer options/,
  );
});

test("curated fallback provides all sentences for complete sentence-by-sentence breakdown", () => {
  const story1 = generateCuratedStory({ level: "HSK 1" });
  assert.equal(story1.sentences.length, 18, "HSK 1 curated story must contain all 18 sentences");
  for (const s of story1.sentences) {
    assert.ok(s.hanzi && s.pinyin && s.english);
  }

  const story2 = generateCuratedStory({ level: "HSK 2" });
  assert.equal(story2.sentences.length, 15, "HSK 2 curated story must contain all 15 sentences");
  for (const s of story2.sentences) {
    assert.ok(s.hanzi && s.pinyin && s.english);
  }
});

test("alignAllSentences completes missing sentences if an AI response only returns partial sentences", async () => {
  const { alignAllSentences } = await import("../assets/js/story.mjs");
  const partialStory = {
    paragraphs: [
      "今天天气很好。我和朋友去商店买东西。",
      "下午我们在家看电影。电影很好看。",
    ],
    sentences: [
      { hanzi: "今天天气很好。", pinyin: "Jīntiān tiānqì hěn hǎo.", english: "Today's weather is good." },
    ],
  };

  const aligned = alignAllSentences(partialStory);
  assert.equal(aligned.length, 4, "Must extract and include all 4 sentences from paragraphs");
  assert.equal(aligned[0].hanzi, "今天天气很好。");
  assert.equal(aligned[1].hanzi, "我和朋友去商店买东西。");
  assert.equal(aligned[2].hanzi, "下午我们在家看电影。");
  assert.equal(aligned[3].hanzi, "电影很好看。");
});

test("generateStoryWithAI attaches clear notice when AI service returns 401 Unauthorized", async () => {
  const mock401Fetcher = async () => {
    const error = new Error("Firebase App Check token is invalid (401 Unauthorized)");
    error.status = 401;
    throw error;
  };

  const config = {
    enabled: true,
    firebaseConfig: { apiKey: "test-key", projectId: "test-proj" },
    recaptchaEnterpriseSiteKey: "test-site-key",
  };

  const story = await generateStoryWithAI({
    level: "HSK 1",
    config,
    fetcher: mock401Fetcher,
    importModule: async () => ({
      initializeApp: () => ({ name: "testApp" }),
    }),
  });

  assert.ok(story.aiNotice, "Story must attach aiNotice on error");
  assert.equal(story.aiNotice.isFallback, true);
  assert.equal(story.aiNotice.isUnauthorized, true);
  assert.match(story.aiNotice.error, /401 Unauthorized/);
  assert.equal(story.sentences.length, 18, "Fallback story must still contain all 18 sentences");
});


test("initializeFirebaseServices initializes App Check with ReCaptchaEnterpriseProvider when site key is present", async () => {
  let appInitializedWith = null;
  let appCheckConfig = null;
  let providerSiteKey = null;

  const mockAppApi = {
    initializeApp: (cfg) => {
      appInitializedWith = cfg;
      return { name: "mockApp" };
    },
  };

  const mockAppCheckApi = {
    initializeAppCheck: (app, options) => {
      appCheckConfig = { app, options };
      return { appCheck: true };
    },
    ReCaptchaEnterpriseProvider: class {
      constructor(siteKey) {
        providerSiteKey = siteKey;
      }
    },
  };

  const mockImport = async (url) => {
    if (url.includes("firebase-app.js")) return mockAppApi;
    if (url.includes("firebase-app-check.js")) return mockAppCheckApi;
    return {};
  };

  const config = {
    firebaseConfig: { apiKey: "fakeKey", projectId: "test-proj" },
    recaptchaEnterpriseSiteKey: "test-recaptcha-key-12345",
  };

  const { app } = await initializeFirebaseServices({
    config,
    reset: true,
    importModule: mockImport,
  });

  assert.equal(app.name, "mockApp");
  assert.equal(appInitializedWith.projectId, "test-proj");
  assert.equal(providerSiteKey, "test-recaptcha-key-12345");
  assert.equal(appCheckConfig.options.isTokenAutoRefreshEnabled, true);
});

test("generateStoryWithAI passes Authorization and X-Firebase-AppCheck headers", async () => {
  const storyJSON = JSON.stringify({
    title: "星期天",
    paragraphs: ["这是一个好故事。"],
    questions: [
      { question: "Where did they go?", options: ["商店", "饭店", "学校"], correctIndex: 0, explanation: "Exp" },
      { question: "What did they buy?", options: ["苹果", "香蕉", "西瓜"], correctIndex: 0, explanation: "Exp" },
    ],
  });

  let capturedHeaders = null;
  const mockFetcher = async (url, options) => {
    if (String(url).includes("generateContent")) {
      capturedHeaders = options.headers;
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: storyJSON }] } }],
        }),
      };
    }
    return { ok: false };
  };

  const mockApp = { name: "testApp" };
  const mockImport = async () => ({
    initializeApp: () => mockApp,
  });

  const config = {
    enabled: true,
    firebaseConfig: { apiKey: "test-api-key", projectId: "test-proj" },
  };

  const story = await generateStoryWithAI({
    level: ["HSK 1", "HSK 2"],
    targetLength: "300 characters",
    theme: "Testing auth token passing",
    config,
    authToken: "mock-id-token-abc123",
    appCheckToken: "mock-appcheck-token-xyz789",
    fetcher: mockFetcher,
    importModule: mockImport,
  });

  assert.equal(story.title, "星期天");
  assert.ok(capturedHeaders, "Headers must be passed to request");
  assert.equal(capturedHeaders["Authorization"], "Bearer mock-id-token-abc123");
  assert.equal(capturedHeaders["X-Firebase-AppCheck"], "mock-appcheck-token-xyz789");
});

test("CSS strictly hides story paragraphs and sentences when hidden attribute is set", () => {
  const css = readFileSync(new URL("../assets/css/story.css", import.meta.url), "utf8");
  assert.match(css, /\.story-view\s+\[hidden\]/);
  assert.match(css, /#story-paragraphs\[hidden\]/);
  assert.match(css, /#story-sentences\[hidden\]/);
  assert.match(css, /display:\s*none\s*!important/);
});

test("view mode defaults to paragraph view and switches to paginated sentence breakdown", async () => {
  const { initStoryView } = await import("../assets/js/story.mjs");

  // Create lightweight DOM mock
  const elements = {};
  const mockDoc = {
    getElementById: (id) => {
      if (!elements[id]) {
        elements[id] = {
          id,
          hidden: false,
          textContent: "",
          disabled: false,
          setAttribute(k, v) { this[k] = v; },
          addEventListener() {},
          querySelectorAll: () => [],
          appendChild() {},
        };
      }
      return elements[id];
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  };

  const savedDoc = globalThis.document;
  try {
    globalThis.document = mockDoc;
    const controller = initStoryView();

    // Default mode: paragraph view visible, sentence pagination hidden
    controller.updateViewMode(true);
    assert.equal(controller.isParagraphMode(), true);
    assert.equal(mockDoc.getElementById("story-paragraphs").hidden, false);
    assert.equal(mockDoc.getElementById("story-sentences-pagination").hidden, true);
    assert.equal(mockDoc.getElementById("story-toggle-viewmode").textContent, "View Sentence Breakdown");

    // Toggle to sentence breakdown mode: sentence pagination visible, paragraphs hidden
    controller.updateViewMode(false);
    assert.equal(controller.isParagraphMode(), false);
    assert.equal(mockDoc.getElementById("story-paragraphs").hidden, true);
    assert.equal(mockDoc.getElementById("story-sentences-pagination").hidden, false);
    assert.equal(mockDoc.getElementById("story-toggle-viewmode").textContent, "View as Paragraphs");

    // Test sentence pagination navigation methods
    assert.equal(typeof controller.nextSentence, "function");
    assert.equal(typeof controller.prevSentence, "function");
    assert.equal(controller.getCurrentSentenceIndex(), 0);

    // Toggle back to paragraph mode
    controller.updateViewMode(true);
    assert.equal(controller.isParagraphMode(), true);
    assert.equal(mockDoc.getElementById("story-paragraphs").hidden, false);
    assert.equal(mockDoc.getElementById("story-sentences-pagination").hidden, true);
    assert.equal(mockDoc.getElementById("story-toggle-viewmode").textContent, "View Sentence Breakdown");
  } finally {
    globalThis.document = savedDoc;
  }
});





test("story theme pool has 30 unique themes and shuffles distinct subsets", async () => {
  const { storyThemes, pickRandomThemes } = await import("../data/story-themes.mjs");
  assert.equal(storyThemes.length, 30);
  assert.equal(new Set(storyThemes.map((t) => t.value)).size, 30);
  for (const t of storyThemes) {
    assert.ok(t.emoji && t.label && t.value);
  }
  const picked = pickRandomThemes(5);
  assert.equal(picked.length, 5);
  assert.equal(new Set(picked.map((t) => t.value)).size, 5);
  assert.ok(picked.every((t) => storyThemes.includes(t)));
});

test("loading screen hides setup/reader and is dismissed when switching screens", async () => {
  const { initStoryView } = await import("../assets/js/story.mjs");
  const elements = {};
  const mockDoc = {
    getElementById: (id) => {
      if (!elements[id]) {
        elements[id] = {
          id,
          hidden: false,
          textContent: "",
          setAttribute(k, v) { this[k] = v; },
          addEventListener() {},
          querySelectorAll: () => [],
          focus() {},
          scrollIntoView() {},
        };
      }
      return elements[id];
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  };
  const savedDoc = globalThis.document;
  try {
    globalThis.document = mockDoc;
    const controller = initStoryView();
    controller.showLoadingScreen({ levels: ["HSK 2"], targetLength: "300 characters", theme: "Zoo" });
    assert.equal(elements["story-loading-page"].hidden, false);
    assert.equal(elements["story-setup-page"].hidden, true);
    assert.equal(elements["story-reader-page"].hidden, true);
    assert.match(elements["story-loading-spec"].textContent, /HSK 2 · 300 characters · Theme: Zoo/);

    controller.showReaderScreen();
    assert.equal(elements["story-loading-page"].hidden, true);
    assert.equal(elements["story-reader-page"].hidden, false);

    controller.showLoadingScreen();
    controller.showSetupScreen();
    assert.equal(elements["story-loading-page"].hidden, true);
    assert.equal(elements["story-setup-page"].hidden, false);
  } finally {
    globalThis.document = savedDoc;
  }
});

test("validateStoryOutput keeps aligned option pinyin/English and drops misaligned ones", async () => {
  const { validateStoryOutput, generateCuratedStory } = await import("../assets/js/story-ai.mjs");
  const data = validateStoryOutput({
    title: "测试",
    paragraphs: ["你好。"],
    questions: [
      {
        question: "Q1?",
        options: ["一", "二", "三"],
        optionsPinyin: ["yī", "èr", "sān"],
        optionsEnglish: ["one", "two", "three"],
        correctIndex: 1,
      },
      { question: "Q2?", options: ["一", "二", "三"], optionsPinyin: ["yī"], correctIndex: 0 },
    ],
  });
  assert.deepEqual(data.questions[0].optionsPinyin, ["yī", "èr", "sān"]);
  assert.deepEqual(data.questions[0].optionsEnglish, ["one", "two", "three"]);
  assert.deepEqual(data.questions[1].optionsPinyin, []);
  assert.deepEqual(data.questions[1].optionsEnglish, []);

  for (const level of ["HSK 1", "HSK 2"]) {
    for (const q of generateCuratedStory({ level }).questions) {
      assert.equal(q.optionsPinyin.length, q.options.length);
      assert.equal(q.optionsEnglish.length, q.options.length);
    }
  }
});
