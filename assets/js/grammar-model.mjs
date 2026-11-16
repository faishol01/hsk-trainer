import { norm } from "./utils.mjs";

export const GRAMMAR_COLUMNS = [
  "HSK",
  "Code",
  "Lesson",
  "Structure",
  "Pinyin",
  "English Equivalent",
  "Example",
  "Example Pinyin",
  "Example Translation",
];

// Read the supplied TSV as data, including quoted tabs/newlines and escaped quotes.
export function parseGrammarTSV(text) {
  const table = [],
    row = [];
  let field = "",
    quoted = false;
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field === "") quoted = !quoted;
      else field += char;
    } else if (!quoted && (char === "\t" || char === "\n")) {
      row.push(field);
      field = "";
      if (char === "\n") {
        if (row.some((value) => value.trim())) table.push(row.slice());
        row.length = 0;
      }
    } else field += char;
  }
  if (quoted)
    throw new Error("The grammar TSV contains an unclosed quoted field.");
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) table.push(row.slice());
  }
  if (
    !table.length ||
    GRAMMAR_COLUMNS.some((name, i) => table[0][i]?.trim() !== name) ||
    table[0].length !== 9
  ) {
    throw new Error(
      "The grammar TSV does not have the expected nine-column header.",
    );
  }
  return table.slice(1).map((fields, id) => {
    const values = fields.map((value) => value.trim());
    const level = Number(values[0]);
    if (
      values.length !== 9 ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 6 ||
      (!values[3] && !values[5])
    ) {
      throw new Error(`Invalid grammar entry on row ${id + 2}.`);
    }
    return {
      id,
      level,
      code: values[1],
      lesson: values[2],
      structure: values[3],
      pinyin: values[4],
      meaning: values[5],
      example: values[6],
      examplePinyin: values[7],
      translation: values[8],
    };
  });
}

export function filterGrammar(entries, { query = "", level = "all" } = {}) {
  const search = norm(query.trim());
  return entries.filter(
    (entry) =>
      (level === "all" || entry.level === Number(level)) &&
      (!search ||
        norm(
          [
            entry.code,
            entry.structure,
            entry.pinyin,
            entry.meaning,
            entry.example,
            entry.examplePinyin,
            entry.translation,
          ].join(" "),
        ).includes(search)),
  );
}

export function grammarCounts(entries) {
  return Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [
      i + 1,
      entries.filter((entry) => entry.level === i + 1).length,
    ]),
  );
}
