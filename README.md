# HSK Word Viewer AI Handover

*Current implementation and continuation guide*

Prepared 4 November 2026. This guide is for an AI or developer continuing the user’s Mandarin vocabulary viewer. Start with the current HTML and sentence TSV; verify their latest versions before editing. The user expects changes to the existing viewer rather than a replacement prototype.

## Current deliverables

[Current HSK word viewer](./index.html)

[Sentence source cmn_sen_db_2.tsv](./data/cmn_sen_db_2.tsv)

[Original HSK 1–4 combined TSV](./data/hsk-1-4-combined.tsv)

[Original HSK 1–4 word links TSV](./data/hsk-1-4-word-links.tsv)

The viewer was last observed at Library version 46 in this conversation. Recheck the current version before writeback. The two TSV exports predate deduplication and numbered meanings; they are references, not exact exports of the current viewer.

## Current content and user expectations

The viewer embeds 1,993 entries: 300 HSK 1, 199 HSK 2, 497 HSK 3 and 997 HSK 4. Each data row is [Chinese characters, pinyin, part of speech, English meaning, HSK level]. Seven entries with identical characters and normalized pinyin were merged; distinct meanings are numbered, and the first listed level is retained. Same spelling with different readings remains separate.

Keep the network, search, filters, quiz, sentence examples, audio and stored quiz progress working when adding features. Prefer direct implementation and avoid requiring the user to confirm routine choices.

## Architecture and network

The application is a single HTML file with embedded CSS, application JavaScript, vocabulary data, initial coordinates, sentence ID index and vis-network 9.1.9. The vis-network library is bundled inline. There is no build system or maintained external source tree in the deliverable; locate the final application script after the bundled library before editing.

### Network data and layout

- The embedded data array is the authoritative vocabulary for the current app. IDs are array indices. The initialPositions array is parallel to that array and came from the user’s exported coordinates. Validate word, pinyin, level and ID alignment before replacing or reordering either array.

- Edges are built at runtime from character containment, classified as prefix, suffix or infix. Entries with identical characters and different pinyin receive a separate different-reading link and a ◈ mark. These are spelling-based links, not verified semantic relationships.

- The network uses the imported positions as a starting layout, runs vis-network physics, then automatically freezes after ten seconds and separates bounding boxes. Pause and Resume arrangement remains available. The loading overlay and inert sidebar clear when the initial network is ready; Practice quiz can be requested while it is loading.

### Browsing and audio

The sidebar supports tone-insensitive pinyin search, sorting, HSK filters, a different-reading filter and link counts. HSK 1–4 have distinct colors. Selecting a node highlights its direct links. Show all restores the network view while preserving the active filters.

The Speak button sends the selected Chinese characters to the unofficial Google Translate TTS endpoint with a Mandarin locale; example sentence playback sends the full sentence. This needs internet access and does not save audio files. A 700 ms delay is applied before playback. For polyphonic characters, the service can choose a different pronunciation from the selected entry; it is not a guaranteed pinyin-controlled voice.

## Sentences and quiz

### Sentence loading

The HTML stores localSentenceData.byWord as word → sentence-ID arrays; it does not embed the sentence text. The source file has five TSV columns: ID, simplified Chinese, traditional Chinese, pinyin and English. At last inspection the index covered 1,944 written words and 23,772 unique sentence IDs, with up to 20 IDs per word; the Examples panel displays up to five.

Loading order is: cmn_sen_db_2.tsv beside the served HTML, then the raw GitHub source, then a user-selected TSV if both fail. The TSV parser loads referenced rows into memory and rejects a file with missing indexed IDs. The source is approximately 10 MB. Pinyin and translations in that corpus were automatically generated and may be inaccurate; character-substring matches can represent a different sense or reading. Some words have fewer than five sentences or none.

### Quiz behavior

Quiz opens a dedicated full-screen view from the header, including its own HSK level selectors. Modes are character to translation, translation to character, character to tone-marked pinyin, fill in the sentence and mixed. Quiz setup is hidden during a test and can be reopened. Distractors favor linked words, similar spellings or readings, shared translation tokens and the same level; semantic ambiguity can still occur.

Sentence questions are generated on demand from indexed examples. One or sometimes two words are blanked; in the current version a two-blank question uses one combined answer choice. The user can reveal pinyin with the target readings masked or the full English translation. Some entries are excluded from character-only prompts when multiple readings make the answer ambiguous. Questions are not pregenerated.

### Stored progress

Quiz answers are written to browser IndexedDB database hsk-word-quiz, object store wordProgress. The stable key is JSON.stringify([characters, normalized lower-case pinyin]); records include correct and incorrect counts, counts by mode, HSK level and the last result and timestamp. Both missing words in a sentence question receive the outcome of the combined answer. Do not clear or silently migrate progress. If the database fails, the UI reports that progress could not be saved.

## Adding words or features

### When a new HSK list is provided

- Inspect the TSV schema, encoding, row count and missing fields. Existing numbered source lists are number, characters, pinyin, part of speech and meaning; the existing combined export omits the number and appends the source level.

- Deduplicate only entries with the same written characters and the same normalized reading. Preserve different readings as separate entries. Merge distinct meanings with numbering; retain the earliest existing HSK level unless the user directs otherwise.

- Update the embedded vocabulary and parallel coordinates together. Match saved coordinates by stable word and reading, not by position alone. Supply sensible initial positions for new nodes; check the whole mapping and lengths before releasing.

- Add the level to colors, legends, sidebar filters and quiz level selectors. Rebuild and validate the word-to-sentence-ID index from the original TSV; reuse sentence IDs instead of duplicating sentence text. Recalculate coverage and report missing examples.

- Review alternate-reading links, search, sorting, quiz eligibility and IndexedDB keys. Preserve existing IDs only when safe; stored progress is keyed by word and pinyin rather than array index.

### When implementing a feature

Inspect the current HTML before editing. The final application code is inside the last script element; the large earlier script is the bundled vis-network library. Preserve its license and avoid accidentally replacing it. When the original sentence file changes, rebuild the index from that exact file: reusing IDs with a different corpus can produce wrong sentences even if the IDs exist.

## Verification and known limits

- Run a JavaScript syntax check on the extracted final application script. Validate row counts, unique character-and-pinyin keys, coordinate alignment and sentence-ID coverage. Exercise all HSK filters and all quiz modes, including two blanks, progress persistence, resume and fallback loading.

- Test in a real browser where possible: initial loading and quiz during loading, local/remote/upload fallback, example playback, screen sizing, IndexedDB and network pause/resume. Previous work used mocked tests and syntax checks; browser rendering, Google playback and pronunciation were not verified in this environment.

- The raw GitHub fallback and unofficial TTS endpoint depend on external availability. Audio requests send the selected characters or sentence to Google. Avoid asserting that generated translations, readings or distractors are linguistically verified.

Current scratch scripts and file paths are temporary. Use the current user-provided files and the linked deliverables as the working source; do not assume a previous workspace will persist.
