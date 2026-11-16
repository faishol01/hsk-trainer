import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GRAMMAR_COLUMNS,
  parseGrammarTSV,
  filterGrammar,
  grammarCounts,
} from "../assets/js/grammar-model.mjs";
import { featureFromHash, FEATURES } from "../assets/js/shell.mjs";

const text = readFileSync(
  new URL("../data/hsk-1-6-grammar.tsv", import.meta.url),
  "utf8",
);

test("the supplied grammar TSV loads all 692 entries and all six levels", () => {
  const entries = parseGrammarTSV(text);
  assert.equal(entries.length, 692);
  assert.deepEqual(grammarCounts(entries), {
    1: 59,
    2: 61,
    3: 77,
    4: 172,
    5: 209,
    6: 114,
  });
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  assert.equal(entries[0].structure, "什么");
  assert.equal(entries[0].translation, "What is this?");
  assert.equal(entries.at(-1).structure, "不无");
  assert.equal(entries.filter((entry) => entry.code === "1.03.1").length, 2);
});

test("grammar search matches characters, tone-insensitive pinyin, meaning, example and code", () => {
  const entries = parseGrammarTSV(text);
  assert.ok(
    filterGrammar(entries, { query: "shenme" }).some(
      (entry) => entry.structure === "什么",
    ),
  );
  assert.ok(
    filterGrammar(entries, { query: "这是什么" }).some(
      (entry) => entry.example === "这是什么?",
    ),
  );
  assert.ok(
    filterGrammar(entries, { query: "not without" }).some(
      (entry) => entry.structure === "不无",
    ),
  );
  assert.equal(filterGrammar(entries, { query: "1.03.1" }).length, 2);
  assert.equal(filterGrammar(entries, { level: "4" }).length, 172);
  assert.ok(
    filterGrammar(entries, { query: "什么", level: "1" }).every(
      (entry) => entry.level === 1,
    ),
  );
  assert.equal(
    filterGrammar(entries, { query: "no-such-grammar-term" }).length,
    0,
  );
});

test("TSV parsing supports BOM, CRLF, quoted tabs, newlines and escaped quotes", () => {
  const header = "\uFEFF" + GRAMMAR_COLUMNS.join("\t") + "\r\n";
  const body =
    '1\t1.1\tLesson\t"说""你好"""\tshuō\t"say\thello"\t"你好\r\n再见"\tnǐ hǎo\thello\r\n\r\n';
  const [entry] = parseGrammarTSV(header + body);
  assert.equal(entry.structure, '说"你好"');
  assert.equal(entry.meaning, "say\thello");
  assert.equal(entry.example, "你好\n再见");
  assert.equal(parseGrammarTSV(header).length, 0);
});

test("bad grammar schemas and incomplete rows fail visibly instead of dropping data", () => {
  assert.throws(() => parseGrammarTSV("word\tmeaning\n你\tyou"), /header/);
  const header = GRAMMAR_COLUMNS.join("\t") + "\n";
  assert.throws(
    () => parseGrammarTSV(header + "7\tx\tLesson\t结构\tp\te\tx\tp\te"),
    /row/,
  );
  assert.throws(() => parseGrammarTSV(header + "1\tx\tLesson\t结构"), /row/);
  assert.throws(
    () => parseGrammarTSV(header + '1\tx\tLesson\t"unfinished'),
    /unclosed/,
  );
});

test("the chooser accepts only the known routes and defaults to home", () => {
  for (const feature of FEATURES) {
    assert.equal(featureFromHash("#" + feature), feature);
    assert.equal(featureFromHash("#/" + feature.toUpperCase()), feature);
  }
  for (const hash of ["", "#home", "#unknown", "#../../file", "#<script>"])
    assert.equal(featureFromHash(hash), "home");
});

test("the first page offers six features and loads no vocabulary or network code eagerly", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = readFileSync(
    new URL("../assets/js/bootstrap.js", import.meta.url),
    "utf8",
  );
  assert.match(html, /<body data-feature="home">/);
  for (const feature of FEATURES)
    assert.match(html, new RegExp('href="#' + feature + '"'));
  assert.doesNotMatch(html, /<script[^>]*vis-network/);
  assert.doesNotMatch(
    bootstrap,
    /vocabulary|vis-network|startApp|features\.mjs/,
  );
  assert.match(bootstrap, /shell\.mjs/);
});
