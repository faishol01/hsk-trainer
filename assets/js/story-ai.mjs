// Firebase AI Logic and App Check (reCAPTCHA Enterprise) story generation service
import { parseGrammarTSV } from "./grammar-model.mjs";

export const SDK_VERSION = "13.2.0";

let appPromise = null;
let appCheckInitialized = false;
let grammarDataPromise = null;

/**
 * Loads and caches HSK grammar structures from data/hsk-1-6-grammar.tsv
 */
export async function loadGrammarData(fetcher = fetch) {
  if (!grammarDataPromise) {
    grammarDataPromise = (async () => {
      try {
        const url = new URL("../../data/hsk-1-6-grammar.tsv", import.meta.url);
        const res = await fetcher(url);
        if (!res.ok) return [];
        const text = await res.text();
        return parseGrammarTSV(text);
      } catch (err) {
        console.warn("Could not load grammar TSV for AI prompt:", err);
        return [];
      }
    })();
  }
  return grammarDataPromise;
}

/**
 * Load Firebase configuration
 */
export async function loadFirebaseConfig(fetcher = fetch) {
  const url = new URL("../../data/firebase-config.json", import.meta.url);
  const res = await fetcher(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load Firebase configuration");
  return res.json();
}

export function resetFirebaseServices() {
  appPromise = null;
  appCheckInitialized = false;
}

/**
 * Initializes Firebase App and App Check with reCAPTCHA Enterprise
 */
export async function initializeFirebaseServices({
  config,
  reset = false,
  sdkVersion = SDK_VERSION,
  importModule = (url) => import(url),
} = {}) {
  if (reset) {
    resetFirebaseServices();
  }
  if (!appPromise) {
    appPromise = (async () => {
      const base = `https://www.gstatic.com/firebasejs/${sdkVersion}/`;
      const appApi = await importModule(base + "firebase-app.js");
      const app = appApi.initializeApp(config.firebaseConfig);
      let appCheck = null;
      let appCheckApi = null;
      let auth = null;
      let authApi = null;

      // Initialize App Check with reCAPTCHA Enterprise if site key is configured
      if (config.recaptchaEnterpriseSiteKey && !appCheckInitialized) {
        try {
          if (
            typeof location !== "undefined" &&
            (location.hostname === "localhost" ||
              location.hostname === "127.0.0.1")
          ) {
            // Enable debug token in local development environment
            if (typeof self !== "undefined") {
              self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
            }
          }
          appCheckApi = await importModule(
            base + "firebase-app-check.js",
          );
          if (appCheckApi?.initializeAppCheck && appCheckApi?.ReCaptchaEnterpriseProvider) {
            appCheck = appCheckApi.initializeAppCheck(app, {
              provider: new appCheckApi.ReCaptchaEnterpriseProvider(
                config.recaptchaEnterpriseSiteKey,
              ),
              isTokenAutoRefreshEnabled: true,
            });
            appCheckInitialized = true;
          }
        } catch (appCheckErr) {
          console.warn("App Check (reCAPTCHA Enterprise) initialization note:", appCheckErr);
        }
      }

      // Initialize Auth if available
      try {
        authApi = await importModule(base + "firebase-auth.js");
        if (typeof authApi?.getAuth === "function") {
          auth = authApi.getAuth(app);
        }
      } catch (authErr) {
        console.warn("Auth initialization note:", authErr);
      }

      return { app, base, appCheck, appCheckApi, auth, authApi };
    })();
  }
  return appPromise;
}

/**
 * Executes reCAPTCHA Enterprise using grecaptcha.enterprise.execute
 */
export async function executeRecaptchaEnterprise(
  siteKey = "6LftcDMuAAAAAN94wgFGS7gdcEhYbLdvudj_3USN",
  action = "GENERATE_STORY",
) {
  if (typeof window === "undefined" || !window.grecaptcha?.enterprise) {
    return null;
  }
  return new Promise((resolve) => {
    try {
      window.grecaptcha.enterprise.ready(async () => {
        try {
          const token = await window.grecaptcha.enterprise.execute(siteKey, { action });
          resolve(token);
        } catch (err) {
          console.warn("reCAPTCHA Enterprise execute note:", err);
          resolve(null);
        }
      });
    } catch (err) {
      console.warn("reCAPTCHA Enterprise ready note:", err);
      resolve(null);
    }
  });
}

/**
 * Retrieves the current Firebase Auth ID token and App Check / reCAPTCHA Enterprise token if available
 */
export async function getAuthToken({ auth, appCheck, appCheckApi, recaptchaSiteKey } = {}) {
  let idToken = null;
  let appCheckToken = null;

  if (auth?.currentUser) {
    try {
      idToken = await auth.currentUser.getIdToken(true);
    } catch (err) {
      console.warn("Could not retrieve Auth ID token:", err);
    }
  }

  // First try direct reCAPTCHA enterprise execution token if available
  if (recaptchaSiteKey) {
    try {
      const enterpriseToken = await executeRecaptchaEnterprise(recaptchaSiteKey, "GENERATE_STORY");
      if (enterpriseToken) {
        appCheckToken = enterpriseToken;
      }
    } catch (err) {
      console.warn("reCAPTCHA Enterprise token retrieval note:", err);
    }
  }

  // Fallback or augment with App Check SDK getToken if needed
  if (!appCheckToken && appCheck && appCheckApi?.getToken) {
    try {
      const res = await appCheckApi.getToken(appCheck, false);
      appCheckToken = res?.token || null;
    } catch (err) {
      console.warn("Could not retrieve App Check token:", err);
    }
  }

  return { idToken, appCheckToken };
}

/**
 * Normalizes user-selected HSK level(s) (string or array) into canonical name and level numbers
 */
export function normalizeLevel(level) {
  if (Array.isArray(level)) {
    const numbers = Array.from(
      new Set(
        level
          .map((item) => {
            const m = String(item).match(/\b([1-6])\b/);
            return m ? parseInt(m[1], 10) : null;
          })
          .filter((n) => n !== null),
      ),
    ).sort((a, b) => a - b);

    if (numbers.length === 0) return { name: "HSK 1", levels: [1] };
    if (numbers.length === 1) return { name: `HSK ${numbers[0]}`, levels: numbers };
    if (numbers.length === 2) return { name: `HSK ${numbers[0]} and ${numbers[1]}`, levels: numbers };
    return { name: `HSK ${numbers[0]} to ${numbers[numbers.length - 1]}`, levels: numbers };
  }

  const str = String(level).trim();
  const matches = Array.from(str.matchAll(/\b([1-6])\b/g)).map((m) => parseInt(m[1], 10));
  const numbers = Array.from(new Set(matches)).sort((a, b) => a - b);
  if (numbers.length === 0) return { name: "HSK 1", levels: [1] };
  if (numbers.length === 1) return { name: `HSK ${numbers[0]}`, levels: numbers };
  if (numbers.length === 2) return { name: `HSK ${numbers[0]} and ${numbers[1]}`, levels: numbers };
  return { name: `HSK ${numbers[0]} to ${numbers[numbers.length - 1]}`, levels: numbers };
}

/**
 * Builds the AI generation prompt based on HSK_STORY_PROMPT.md,
 * incorporating sample grammar points from data/hsk-1-6-grammar.tsv.
 */
export function buildStoryPrompt({
  level = "HSK 1",
  targetLength = "300 characters",
  theme = "",
  grammarEntries = [],
}) {
  const norm = normalizeLevel(level);

  // Extract representative grammar patterns from the dataset for this level
  const levelPatterns = grammarEntries.filter((g) => norm.levels.includes(g.level));
  // Sample up to 6 distinct patterns
  const sampled = levelPatterns.slice(0, 8).map(
    (g) => `- "${g.structure}" (${g.meaning}, e.g. ${g.example})`,
  );
  const grammarReferenceText = sampled.length
    ? `\nReference grammar structures for ${norm.name} from curriculum:\n${sampled.join("\n")}\n`
    : "";

  return `You are an expert Chinese language teacher and graded reader author specializing in the official HSK curriculum and standard HSK 1–6 grammar structures.

Your task is to write a natural, level-locked Chinese short story that reinforces core grammar patterns and vocabulary for ${norm.name}, followed by reading comprehension questions.

### User Inputs:
- Target Level: ${norm.name}
- Target Length: ${targetLength}
- Story Theme: ${theme.trim() ? theme.trim() : "Relatable everyday Chinese scenario (e.g. food, friends, campus, travel)"}

### Strict Rules:
1. Strict Level Lock:
   - 100% of words and grammar in the story must strictly belong to ${norm.name} or lower.
   - Do NOT use higher-level idioms, advanced vocabulary, or complex conjunctions.
2. Grammar Selection:
   - Select 3 to 5 core grammar structures characteristic of ${norm.name}.
   - Bold (**pattern**) each grammar structure in the Chinese paragraphs.
${grammarReferenceText}
3. Reading Comprehension Questions:
   - Generate between 2 to 5 reading comprehension questions based on the generated story.
   - CRITICAL REQUIREMENT: Each question MUST be in English.
   - CRITICAL REQUIREMENT: Each question MUST have 3 or 4 answer options written in Hanzi (Chinese characters).
   - Indicate which option is correct (0-based index) and provide a clear explanation in English.

4. Sentence Breakdown Requirement:
   - CRITICAL REQUIREMENT: The "sentences" array MUST contain EVERY SINGLE sentence from the story paragraphs, in exact sequential order from beginning to end. Do not skip or truncate any sentences.

### Required JSON Output:
Return ONLY valid, parseable JSON conforming to this exact schema without any codeblock backticks or surrounding text:
{
  "title": "Story Title in Chinese",
  "pinyinTitle": "Pinyin with tones",
  "englishTitle": "English Title",
  "paragraphs": [
    "First paragraph text in Chinese with target grammar in **bold**...",
    "Second paragraph..."
  ],
  "sentences": [
    {
      "hanzi": "First sentence in Chinese with **bold** grammar",
      "pinyin": "Pinyin for first sentence",
      "english": "English translation"
    }
  ],
  "grammarPoints": [
    {
      "structure": "Grammar pattern name",
      "level": "${norm.name}",
      "example": "Example sentence from story",
      "explanation": "Brief explanation of structure"
    }
  ],
  "vocabulary": [
    {
      "word": "Word",
      "pinyin": "pinyin",
      "pos": "Part of speech",
      "meaning": "English meaning",
      "level": "${norm.name}"
    }
  ],
  "questions": [
    {
      "question": "Question in English?",
      "options": [
        "选项一（Hanzi）",
        "选项二（Hanzi）",
        "选项三（Hanzi）",
        "选项四（Hanzi）"
      ],
      "correctIndex": 0,
      "explanation": "Explanation in English citing the story."
    }
  ]
}`;
}

/**
 * Extracts clean JSON from LLM response (handling potential markdown fences)
 */
export function extractJSONFromResponse(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Empty response received from AI model");
  }
  const trimmed = text.trim();
  // Strip markdown ```json ... ``` or ``` ... ```
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  // If there's leading/trailing non-JSON text, extract outermost { ... }
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON structure found in AI response");
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * Validates the generated story object structure
 */
export function validateStoryOutput(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid story data: expected object");
  }
  if (!data.title || typeof data.title !== "string") {
    throw new Error("Story is missing a title");
  }
  if (!Array.isArray(data.paragraphs) || data.paragraphs.length === 0) {
    throw new Error("Story must contain at least one paragraph");
  }
  if (!Array.isArray(data.questions) || data.questions.length < 2) {
    throw new Error("Story must contain between 2 and 5 comprehension questions");
  }
  for (let i = 0; i < data.questions.length; i++) {
    const q = data.questions[i];
    if (!q.question || typeof q.question !== "string") {
      throw new Error(`Question ${i + 1} must have an English question string`);
    }
    if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 4) {
      throw new Error(`Question ${i + 1} must have 3 or 4 answer options`);
    }
    if (
      typeof q.correctIndex !== "number" ||
      q.correctIndex < 0 ||
      q.correctIndex >= q.options.length
    ) {
      q.correctIndex = 0; // safe fallback
    }
  }
  return data;
}

/**
 * Curated offline fallback generator for testing or offline environments
 */
export function generateCuratedStory({ level = "HSK 1", theme = "" } = {}) {
  const norm = normalizeLevel(level);
  if (norm.levels.includes(2)) {
    return {
      title: "星期天去书店",
      pinyinTitle: "Xīngqītiān qù shūdiàn",
      englishTitle: "Going to the Bookstore on Sunday",
      paragraphs: [
        "今天是星期天，早上八点我就起床了。今天的天气真好，不冷也不热，是一个晴天。**因为**我想买几本新书，**所以**我和朋友准备一起去大商场。朋友家**离**商场很**近**，我家**离**商场有点儿**远**。我们在车站坐地铁，坐地铁**比**坐公交车快。",
        "到了商场门口，朋友走**得比**我快，他高兴地走在前面。在商场里面的书店，我们看见了很多有意思的书。朋友看书看**得**很快，他已经看了三本书，我只看了一本。**虽然**书店里的人很多，**但是**大家说话说**得**很少，里面很舒服。",
        "买完书，我们去商场旁边的饭馆吃午饭。我们买了热咖啡和好吃的菜。这家饭馆的菜真不错，**比**学校的菜好吃。朋友说，他下个月想去中国旅游，**所以**要多学汉字。我笑着对他说：“没关系，我可以帮你！”**虽然**今天走了很多路，有点儿累，**但是**我们玩**得**非常高兴。"
      ],
      sentences: [
        {
          hanzi: "今天是星期天，早上八点我就起床了。",
          pinyin: "Jīntiān shì xīngqītiān, zǎoshang bā diǎn wǒ jiù qǐchuáng le.",
          english: "Today is Sunday, and I got out of bed as early as eight in the morning."
        },
        {
          hanzi: "今天的天气真好，不冷也不热，是一个晴天。",
          pinyin: "Jīntiān de tiānqì zhēn hǎo, bù lěng yě bù rè, shì yī gè qíngtiān.",
          english: "Today's weather is really nice, neither cold nor hot, a sunny day."
        },
        {
          hanzi: "**因为**我想买几本新书，**所以**我和朋友准备一起去大商场。",
          pinyin: "**Yīnwèi** wǒ xiǎng mǎi jǐ běn xīn shū, **suǒyǐ** wǒ hé péngyou zhǔnbèi yīqǐ qù dà shāngchǎng.",
          english: "Because I wanted to buy a few new books, my friend and I prepared to go to the big shopping mall together."
        },
        {
          hanzi: "朋友家**离**商场很**近**，我家**离**商场有点儿**远**。",
          pinyin: "Péngyou jiā **lí** shāngchǎng hěn **jìn**, wǒ jiā **lí** shāngchǎng yǒudiǎnr **yuǎn**.",
          english: "My friend's home is very close to the mall, while my home is a bit far from the mall."
        },
        {
          hanzi: "我们在车站坐地铁，坐地铁**比**坐公交车快。",
          pinyin: "Wǒmen zài chēzhàn zuò dìtiě, zuò dìtiě **bǐ** zuò gōngjiāochē kuài.",
          english: "We took the subway at the station; taking the subway is faster than taking the bus."
        },
        {
          hanzi: "到了商场门口，朋友走**得比**我快，他高兴地走在前面。",
          pinyin: "Dào le shāngchǎng ménkǒu, péngyou zǒu **de bǐ** wǒ kuài, tā gāoxìng de zǒu zài qiánmian.",
          english: "Arriving at the mall entrance, my friend walked faster than me, happily walking in front."
        },
        {
          hanzi: "在商场里面的书店，我们看见了很多有意思的书。",
          pinyin: "Zài shāngchǎng lǐmian de shūdiàn, wǒmen kànjiàn le hěn duō yǒuyìsi de shū.",
          english: "In the bookstore inside the mall, we saw many interesting books."
        },
        {
          hanzi: "朋友看书看**得**很快，他已经看了三本书，我只看了一本。",
          pinyin: "Péngyou kàn shū kàn **de** hěn kuài, tā yǐjīng kàn le sān běn shū, wǒ zhǐ kàn le yī běn.",
          english: "My friend reads books very fast; he had already read three books, while I only read one."
        },
        {
          hanzi: "**虽然**书店里的人很多，**但是**大家说话说**得**很少，里面很舒服。",
          pinyin: "**Suīrán** shūdiàn lǐ de rén hěn duō, **dànshì** dàjiā shuōhuà shuō **de** hěn shǎo, lǐmian hěn shūfu.",
          english: "Although there were many people in the bookstore, everyone spoke very little, so it was very comfortable inside."
        },
        {
          hanzi: "买完书，我们去商场旁边的饭馆吃午饭。",
          pinyin: "Mǎi wán shū, wǒmen qù shāngchǎng pángbiān de fànguǎn chī wǔfàn.",
          english: "After finishing buying books, we went to a restaurant beside the mall to have lunch."
        },
        {
          hanzi: "我们买了热咖啡和好吃的菜。",
          pinyin: "Wǒmen mǎi le rè kāfēi hé hǎochī de cài.",
          english: "We bought hot coffee and delicious dishes."
        },
        {
          hanzi: "这家饭馆的菜真不错，**比**学校的菜好吃。",
          pinyin: "Zhè jiā fànguǎn de cài zhēn búcuò, **bǐ** xuéxiào de cài hǎochī.",
          english: "This restaurant's food was really nice, more delicious than the school's food."
        },
        {
          hanzi: "朋友说，他下个月想去中国旅游，**所以**要多学汉字。",
          pinyin: "Péngyou shuō, tā xià gè yuè xiǎng qù Zhōngguó lǚyóu, **suǒyǐ** yào duō xué hànzì.",
          english: "My friend said that he wants to travel to China next month, so he needs to learn more Chinese characters."
        },
        {
          hanzi: "我笑着对他说：“没关系，我可以帮你！”",
          pinyin: "Wǒ xiào zhe duì tā shuō: “Méi guānxi, wǒ kěyǐ bāng nǐ!”",
          english: "I smiled and said to him: 'No problem, I can help you!'"
        },
        {
          hanzi: "**虽然**今天走了很多路，有点儿累，**但是**我们玩**得**非常高兴。",
          pinyin: "**Suīrán** jīntiān zǒu le hěn duō lù, yǒudiǎnr lèi, **dànshì** wǒmen wán **de** fēicháng gāoxìng.",
          english: "Although we walked a lot today and were a bit tired, we had a very happy time playing."
        }
      ],
      grammarPoints: [
        {
          structure: "因为……所以……",
          level: "HSK 2",
          example: "因为我想买几本新书，所以我和朋友准备一起去大商场。",
          explanation: "Expresses cause and effect (Because... therefore...)."
        },
        {
          structure: "N1 比 N2 + 形容词",
          level: "HSK 2",
          example: "坐地铁比坐公交车快。",
          explanation: "Expresses comparison between two things."
        },
        {
          structure: "动词 + 得 + 形容词",
          level: "HSK 2",
          example: "朋友走得比我快；朋友看书看得很快。",
          explanation: "Complement of degree, evaluating an action."
        },
        {
          structure: "虽然……但是……",
          level: "HSK 2",
          example: "虽然书店里的人很多，但是大家说话说得很少。",
          explanation: "Expresses concession and contrast (Although... but...)."
        }
      ],
      vocabulary: [
        { word: "商场", pinyin: "shāngchǎng", pos: "Noun", meaning: "shopping mall", level: "HSK 2" },
        { word: "离", pinyin: "lí", pos: "Preposition", meaning: "away from", level: "HSK 2" },
        { word: "地铁", pinyin: "dìtiě", pos: "Noun", meaning: "subway", level: "HSK 2" },
        { word: "有意思", pinyin: "yǒuyìsi", pos: "Adjective", meaning: "interesting", level: "HSK 2" },
        { word: "饭馆", pinyin: "fànguǎn", pos: "Noun", meaning: "restaurant", level: "HSK 2" },
        { word: "旅游", pinyin: "lǚyóu", pos: "Verb", meaning: "to travel", level: "HSK 2" }
      ],
      questions: [
        {
          question: "How did the friends travel to the shopping mall?",
          options: ["走路去", "坐公交车去", "坐地铁去", "骑车去"],
          correctIndex: 2,
          explanation: "Sentence 5 states: '我们在车站坐地铁，坐地铁比坐公交车快。'"
        },
        {
          question: "How did the friend read books at the bookstore?",
          options: ["看得很慢", "看得很累", "看得很快", "不想看书"],
          correctIndex: 2,
          explanation: "Sentence 8 states: '朋友看书看得很快，他已经看了三本书。'"
        },
        {
          question: "Where did they go after buying books?",
          options: ["回学校", "去饭馆吃午饭", "去机场", "去买衣服"],
          correctIndex: 1,
          explanation: "Paragraph 3 states: '买完书，我们去商场旁边的饭馆吃午饭。'"
        }
      ]
    };
  }

  // Default HSK 1
  return {
    title: "高兴的一天",
    pinyinTitle: "Gāoxìng de yī tiān",
    englishTitle: "A Happy Day",
    paragraphs: [
      "今天天气很好，不冷也不热。上午，我和朋友去商店买东西。这个商店很大，商店里的东西很多。朋友**想**买苹果，我**想**买茶和牛奶。商店里的苹果很大，不贵，很便宜。我们买了四个大苹果，买了茶，也买了牛奶。",
      "中午，我们**去**饭店**吃**午饭。饭店里人很多，大家都在说话，大家都很高兴。朋友喜欢吃包子，我喜欢吃米饭和菜。这个饭店的菜很好吃，米饭也很好吃。我们吃了午饭，喝了热茶。",
      "下午，朋友来我家看电影。我家有一只小猫，小猫很小，很漂亮。小猫看见我们，叫了一下。小猫想吃东西，我给它一点儿牛奶。五点半，朋友回家了。妈妈问我今天高兴吗，我说：今天**太**好玩儿**了**！"
    ],
    sentences: [
      {
        hanzi: "今天天气很好，不冷也不热。",
        pinyin: "Jīntiān tiānqì hěn hǎo, bù lěng yě bù rè.",
        english: "Today the weather is very good, neither cold nor hot."
      },
      {
        hanzi: "上午，我和朋友去商店买东西。",
        pinyin: "Shàngwǔ, wǒ hé péngyou qù shāngdiàn mǎi dōngxi.",
        english: "In the morning, my friend and I went to the store to buy things."
      },
      {
        hanzi: "这个商店很大，商店里的东西很多。",
        pinyin: "Zhè ge shāngdiàn hěn dà, shāngdiàn lǐ de dōngxi hěn duō.",
        english: "This store is very big, and there are many things in the store."
      },
      {
        hanzi: "朋友**想**买苹果，我**想**买茶和牛奶。",
        pinyin: "Péngyou **xiǎng** mǎi píngguǒ, wǒ **xiǎng** mǎi chá hé niúnǎi.",
        english: "My friend wanted to buy apples, and I wanted to buy tea and milk."
      },
      {
        hanzi: "商店里的苹果很大，不贵，很便宜。",
        pinyin: "Shāngdiàn lǐ de píngguǒ hěn dà, bù guì, hěn piányi.",
        english: "The apples in the store were big, not expensive, and very cheap."
      },
      {
        hanzi: "我们买了四个大苹果，买了茶，也买了牛奶。",
        pinyin: "Wǒmen mǎi le sì gè dà píngguǒ, mǎi le chá, yě mǎi le niúnǎi.",
        english: "We bought four big apples, bought tea, and also bought milk."
      },
      {
        hanzi: "中午，我们**去**饭店**吃**午饭。",
        pinyin: "Zhōngwǔ, wǒmen **qù** fàndiàn **chī** wǔfàn.",
        english: "At noon, we went to a restaurant to eat lunch."
      },
      {
        hanzi: "饭店里人很多，大家都在说话，大家都很高兴。",
        pinyin: "Fàndiàn lǐ rén hěn duō, dàjiā dōu zài shuōhuà, dàjiā dōu hěn gāoxìng.",
        english: "There were many people in the restaurant; everyone was talking, and everyone was very happy."
      },
      {
        hanzi: "朋友喜欢吃包子，我喜欢吃米饭和菜。",
        pinyin: "Péngyou xǐhuan chī bāozi, wǒ xǐhuan chī mǐfàn hé cài.",
        english: "My friend liked eating steamed buns, and I liked eating rice and dishes."
      },
      {
        hanzi: "这个饭店的菜很好吃，米饭也很好吃。",
        pinyin: "Zhè ge fàndiàn de cài hěn hǎochī, mǐfàn yě hěn hǎochī.",
        english: "This restaurant's dishes were very delicious, and the rice was also very delicious."
      },
      {
        hanzi: "我们吃了午饭，喝了热茶。",
        pinyin: "Wǒmen chī le wǔfàn, hē le rè chá.",
        english: "We ate lunch and drank hot tea."
      },
      {
        hanzi: "下午，朋友来我家看电影。",
        pinyin: "Xiàwǔ, péngyou lái wǒ jiā kàn diànyǐng.",
        english: "In the afternoon, my friend came to my home to watch a movie."
      },
      {
        hanzi: "我家有一只小猫，小猫很小，很漂亮。",
        pinyin: "Wǒ jiā yǒu yī zhī xiǎo māo, xiǎo māo hěn xiǎo, hěn piàoliang.",
        english: "There is a little cat at my home; the cat is very small and very pretty."
      },
      {
        hanzi: "小猫看见我们，叫了一下。",
        pinyin: "Xiǎo māo kànjiàn wǒmen, jiào le yīxià.",
        english: "The little cat saw us and meowed briefly."
      },
      {
        hanzi: "小猫想吃东西，我给它一点儿牛奶。",
        pinyin: "Xiǎo māo xiǎng chī dōngxi, wǒ gěi tā yīdiǎnr niúnǎi.",
        english: "The little cat wanted to eat something, so I gave it a little milk."
      },
      {
        hanzi: "五点半，朋友回家了。",
        pinyin: "Wǔ diǎn bàn, péngyou huí jiā le.",
        english: "At 5:30, my friend went home."
      },
      {
        hanzi: "妈妈问我今天高兴吗？",
        pinyin: "Māma wèn wǒ jīntiān gāoxìng ma?",
        english: "Mom asked me if I was happy today."
      },
      {
        hanzi: "我说：“今天**太**好玩儿**了**！”",
        pinyin: "Wǒ shuō: “Jīntiān **tài** hǎowánr **le**!”",
        english: "I said: 'Today was so much fun!'"
      }
    ],
    grammarPoints: [
      {
        structure: "想 + 动词",
        level: "HSK 1",
        example: "朋友想买苹果，我想买茶和牛奶。",
        explanation: "Expresses desire or intention to do something."
      },
      {
        structure: "去 + 地点 + 动词",
        level: "HSK 1",
        example: "我们去饭店吃午饭。",
        explanation: "Indicates going to a place for the purpose of doing an action."
      },
      {
        structure: "太 + 形容词 + 了",
        level: "HSK 1",
        example: "今天太好玩儿了！",
        explanation: "Expresses an exclamation of 'extremely' or 'too'."
      }
    ],
    vocabulary: [
      { word: "商店", pinyin: "shāngdiàn", pos: "Noun", meaning: "shop", level: "HSK 1" },
      { word: "苹果", pinyin: "píngguǒ", pos: "Noun", meaning: "apple", level: "HSK 1" },
      { word: "便宜", pinyin: "piányi", pos: "Adjective", meaning: "cheap", level: "HSK 1" },
      { word: "饭店", pinyin: "fàndiàn", pos: "Noun", meaning: "restaurant", level: "HSK 1" },
      { word: "午饭", pinyin: "wǔfàn", pos: "Noun", meaning: "lunch", level: "HSK 1" },
      { word: "好看", pinyin: "hǎokàn", pos: "Adjective", meaning: "good-looking", level: "HSK 1" }
    ],
    questions: [
      {
        question: "What did the friend want to buy at the store?",
        options: ["想买苹果", "想买西瓜", "想买电脑", "想买衣服"],
        correctIndex: 0,
        explanation: "The story mentions: '朋友想买苹果，我想买茶和牛奶。'"
      },
      {
        question: "Where did they go at noon to have lunch?",
        options: ["去学校", "去饭店", "去医院", "去车站"],
        correctIndex: 1,
        explanation: "The story states: '中午，我们去饭店吃午饭。'"
      },
      {
        question: "What pet does the narrator have at home?",
        options: ["小狗", "小鸟", "小猫", "小鱼"],
        correctIndex: 2,
        explanation: "Paragraph 3 states: '我家有一只小猫，小猫很小，很漂亮。'"
      }
    ]
  };
}

/**
 * Primary generation function using Firebase AI Logic / Vertex AI
 */
export async function generateStoryWithAI({
  level = "HSK 1",
  targetLength = "300 characters",
  theme = "",
  config = null,
  authToken = null,
  appCheckToken = null,
  fetcher = fetch,
  importModule = (url) => import(url),
} = {}) {
  // Load configuration if not provided
  if (!config) {
    config = await loadFirebaseConfig(fetcher);
  }

  // Load grammar references from TSV
  const grammarEntries = await loadGrammarData(fetcher);

  // Build the prompt
  const prompt = buildStoryPrompt({ level, targetLength, theme, grammarEntries });

  // If Firebase is not enabled, return curated fallback
  if (!config?.enabled || !config?.firebaseConfig?.apiKey) {
    return generateCuratedStory({ level, theme });
  }

  try {
    const { app, base, appCheck, appCheckApi, auth } = await initializeFirebaseServices({
      config,
      importModule,
    });

    // Obtain Auth token and App Check / reCAPTCHA Enterprise token
    const siteKey =
      config.recaptchaEnterpriseSiteKey || "6LftcDMuAAAAAN94wgFGS7gdcEhYbLdvudj_3USN";
    const tokens = await getAuthToken({
      auth,
      appCheck,
      appCheckApi,
      recaptchaSiteKey: siteKey,
    });
    const effectiveAuthToken = authToken || tokens.idToken;
    const effectiveAppCheckToken = appCheckToken || tokens.appCheckToken;

    // Check if authenticated-users mode is enforced and user is unsigned
    if (!effectiveAuthToken && config.aiConfig?.enforceAuth) {
      const fallback = generateCuratedStory({ level, theme });
      fallback.aiNotice = {
        isFallback: true,
        isAuthRequired: true,
        error:
          "Authentication required: Firebase AI has authenticated-users mode enabled. Please sign in via Cloud sync to generate live AI stories.",
      };
      return fallback;
    }

    const modelName = config.aiConfig?.model || "gemini-2.0-flash";
    let text = "";

    // Try Firebase AI Logic (firebase-ai.js) first, then Vertex AI (firebase-vertexai.js)
    let aiModule = null;
    try {
      aiModule = await importModule(base + "firebase-ai.js");
    } catch {
      try {
        aiModule = await importModule(base + "firebase-vertexai.js");
      } catch (err) {
        console.warn("Could not dynamically import Firebase AI modules:", err);
      }
    }

    if (aiModule) {
      if (typeof aiModule.getAI === "function") {
        const ai = aiModule.getAI(app);
        const model = aiModule.getGenerativeModel(ai, {
          model: modelName,
          generationConfig: { responseMimeType: "application/json" },
        });
        const result = await model.generateContent(prompt);
        text = result?.response?.text ? result.response.text() : String(result);
      } else if (typeof aiModule.getVertexAI === "function") {
        const vertex = aiModule.getVertexAI(app, {
          location: config.aiConfig?.location || "us-central1",
        });
        const model = aiModule.getGenerativeModel(vertex, {
          model: modelName,
          generationConfig: { responseMimeType: "application/json" },
        });
        const result = await model.generateContent(prompt);
        text = result?.response?.text ? result.response.text() : String(result);
      }
    }

    // Direct REST request with Authorization and App Check headers if SDK did not produce text
    if (!text) {
      const apiKey = config.firebaseConfig.apiKey;
      const endpoint =
        config.aiConfig?.endpoint ||
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const headers = { "Content-Type": "application/json" };
      if (effectiveAuthToken) {
        headers["Authorization"] = `Bearer ${effectiveAuthToken}`;
      }
      if (effectiveAppCheckToken) {
        headers["X-Firebase-AppCheck"] = effectiveAppCheckToken;
      }

      const restRes = await fetcher(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });
      if (restRes.ok) {
        const restJson = await restRes.json();
        text = restJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    }

    if (!text) {
      throw new Error("No response text from AI service");
    }

    const parsed = extractJSONFromResponse(text);
    return validateStoryOutput(parsed);
  } catch (err) {
    const errMsg = String(err?.message || err);
    console.warn("AI generation encountered error, serving curated fallback:", err);
    const fallback = generateCuratedStory({ level, theme });
    const is401 =
      errMsg.includes("401") ||
      errMsg.toLowerCase().includes("app check") ||
      errMsg.toLowerCase().includes("unauthenticated") ||
      errMsg.toLowerCase().includes("unauthorized");

    fallback.aiNotice = {
      isFallback: true,
      isUnauthorized: is401,
      error: is401
        ? "AI service returned 401 Unauthorized (Firebase App Check token invalid or unverified for this domain). Displaying verified level-locked story with all sentences."
        : `AI generation notice: ${errMsg}`,
    };
    return fallback;
  }
}
