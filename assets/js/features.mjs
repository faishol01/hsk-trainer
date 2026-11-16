import { ensureCloudSync } from "./cloud-service.mjs";
import { data } from "../../data/vocabulary.mjs";
import { initFlashcards } from "./flashcards.mjs";
import { initWordStats } from "./stats.mjs";

// Shared progress and interfaces initialize once; heavier features remain lazy.
let features;
export function ensureFeatures({ onHome, onStatistics } = {}) {
  if (features) return features;
  const cloudReady = ensureCloudSync(data);
  const flashcards = initFlashcards(data, cloudReady, {
    bindLaunch: false,
    onClose: onHome,
  });
  const wordStats = initWordStats({
    entries: data,
    cloudReady,
    bindLaunch: false,
    onNavigate: onStatistics,
    onClose: onHome,
  });
  let relationships,
    sentences,
    quiz,
    selected = () => -1;
  const retryable = (load, clear) =>
    load.catch((error) => {
      clear();
      throw error;
    });
  features = {
    data,
    cloudReady,
    flashcards,
    wordStats,
    ensureRelationships() {
      if (!relationships)
        relationships = retryable(
          import("./relationships.mjs").then((module) =>
            module.buildWordRelationships(data),
          ),
          () => {
            relationships = null;
          },
        );
      return relationships;
    },
    ensureSentences() {
      if (!sentences)
        sentences = retryable(
          Promise.all([
            import("./sentences.mjs"),
            import("./audio.mjs"),
            import("../../data/sentence-index.mjs"),
          ]).then(([module, audio, index]) => {
            const speech = audio.createSpeechPlayer();
            const examples = module.initSentenceExamples({
              data,
              localSentenceData: index.localSentenceData,
              getSelected: () => selected(),
              playSpeech: speech.playSpeech,
            });
            return {
              examples,
              speech,
              localSentenceData: index.localSentenceData,
            };
          }),
          () => {
            sentences = null;
          },
        );
      return sentences;
    },
    setSelectedGetter(getter) {
      selected = getter;
    },
    ensureQuiz() {
      if (!quiz)
        quiz = retryable(
          Promise.all([
            import("./quiz.mjs"),
            features.ensureRelationships(),
          ]).then(([module, graph]) => {
            // Sentence resources are optional until the user starts a sentence/mixed quiz.
            const sentenceData = { byWord: {}, sentences: null };
            return module.initQuiz({
              data,
              neighborSets: graph.neighborSets,
              localSentenceData: sentenceData,
              cloudReady,
              async getSentenceCorpus() {
                const source = await features.ensureSentences();
                sentenceData.byWord = source.localSentenceData.byWord;
                const rows = await source.examples.getSentenceCorpus();
                sentenceData.sentences = rows;
                return rows;
              },
              bindLaunch: false,
              onClose: onHome,
            });
          }),
          () => {
            quiz = null;
          },
        );
      return quiz;
    },
    stopSpeech() {
      sentences?.then((source) => source.speech.stopSpeech()).catch(() => {});
    },
  };
  return features;
}
