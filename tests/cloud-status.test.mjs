import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloudStatusLabel } from "../assets/js/cloud-status.mjs";

test("cloud status distinguishes local-only, signed-out, pending, syncing and synced states", () => {
  for (const [phase, text] of Object.entries({
    disabled: "off",
    "signed-out": "signed out",
    pending: "waiting to sync",
    syncing: "syncing...",
    synced: "up to date",
    error: "unavailable",
  })) {
    assert.equal(cloudStatusLabel({ phase }), "Cloud sync: " + text);
  }
});

test("a signed-in offline device never claims its cloud connection is up to date", () => {
  assert.equal(
    cloudStatusLabel({
      phase: "synced",
      account: { uid: "alice" },
      online: false,
    }),
    "Cloud sync: offline",
  );
  assert.equal(
    cloudStatusLabel({ phase: "disabled", account: null, online: false }),
    "Cloud sync: off",
  );
});

test("the shared header has one Home link and no feature buttons beside its title", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const header = html.match(/<header>[\s\S]*?<\/header>/)[0];
  assert.match(header, /Back to home/);
  assert.match(header, /id="page-title"/);
  assert.doesNotMatch(header, /<button/);
  assert.match(html, /id="cloud-sync-indicator"/);
  assert.doesNotMatch(html, /Back to features|Word quiz|<dialog\b/i);
  const toolbar = html.match(/<div class="word-actions">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(toolbar, /id="(?:cloud-open|flashcard-open|quiz-open)"/);
});

test("Statistics is a dedicated page, and every full-page study feature keeps the shared header", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<main\b[^>]*id="stats-view"[^>]*hidden/);
  const pages = readFileSync(
    new URL("../assets/css/pages.css", import.meta.url),
    "utf8",
  );
  assert.match(pages, /position: static/);
  assert.match(pages, /body > header/);
  const quiz = readFileSync(
    new URL("../assets/js/quiz.mjs", import.meta.url),
    "utf8",
  );
  const flashcards = readFileSync(
    new URL("../assets/js/flashcards.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(quiz, /classList\.add\("quiz-active"\)/);
  assert.doesNotMatch(flashcards, /classList\.add\("flashcard-active"\)/);
});
