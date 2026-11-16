# HSK Word Viewer AI Handover

*Current implementation and continuation guide*

Prepared 4 November 2026. This guide is for an AI or developer continuing the user’s Mandarin vocabulary viewer. Start with the current HTML and sentence TSV; verify their latest versions before editing. The user expects changes to the existing viewer rather than a replacement prototype.

## Current deliverables

[Current HSK word viewer](./index.html)

[Sentence source cmn_sen_db_2.tsv](./data/cmn_sen_db_2.tsv)

[Original HSK 1–4 combined TSV](./data/hsk-1-4-words.tsv)

[Original HSK 1–4 word links TSV](./data/hsk-1-4-word-links.tsv)

The viewer was last observed at Library version 46 in this conversation. Recheck the current version before writeback. The two TSV exports predate deduplication and numbered meanings; they are references, not exact exports of the current viewer.

## Current content and user expectations

The viewer loads 1,993 entries: 300 HSK 1, 199 HSK 2, 497 HSK 3 and 997 HSK 4. Each data row is [Chinese characters, pinyin, part of speech, English meaning, HSK level]. Seven entries with identical characters and normalized pinyin were merged; distinct meanings are numbered, and the first listed level is retained. Same spelling with different readings remains separate.

Keep the network, search, filters, quiz, sentence examples, audio and stored quiz progress working when adding features. Prefer direct implementation and avoid requiring the user to confirm routine choices.

## Architecture and network

The application uses HTML, external CSS, and native JavaScript modules. There is no build step. Publish `index.html`, `assets/`, and `data/` together. Run `python serve.py` for local HTTP access; the server exposes those runtime paths and blocks directory listings and other workspace files.

- `index.html`: page markup and external stylesheet/script references.
- `assets/css/viewer.css`, `mobile.css`, `flashcards.css`, `cloud-sync.css`, `stats.css`: base viewer styles, responsive layout, flashcards, cloud controls, and progress statistics. Link order preserves the existing cascade.
- `assets/vendor/vis-network.min.js`: unchanged vis-network 9.1.9 bundle with its license header.
- `assets/js/bootstrap.js`: the deferred feature-menu entry point, with a visible load-error fallback.
- `assets/js/app.mjs`: network initialization, sidebar selection, and feature wiring.
- `assets/js/relationships.mjs`, `utils.mjs`: word relationship computation and shared text helpers.
- `assets/js/quiz.mjs`: quiz engines and quiz interface.
- `assets/js/flashcards.mjs`, `flashcard-model.mjs`: flashcard interface and pure scheduling/selection functions.
- `assets/js/progress.mjs`: existing quiz/flashcard IndexedDB stores with optional cloud routing.
- `assets/js/sentences.mjs`, `audio.mjs`: sentence parsing/loading, example interface, and audio playback.
- `assets/js/mobile.mjs`: mobile word browser and viewport handling.
- `assets/js/cloud-sync.mjs`: optional Firebase integration. Its public configuration remains `data/firebase-config.json`.
- `data/vocabulary.mjs`, `initial-positions.mjs`, `sentence-index.mjs`: authoritative vocabulary, parallel coordinates, and word-to-sentence-ID index. These contain the same data extracted from the original HTML.

A single deferred bootstrap loads the feature shell and displays the chooser first. The shell loads the network library and initializes mobile map navigation only when Word explorer is selected; the app retains its two-frame delay before starting that network. Native module imports are relative, so repository paths on GitHub Pages work without a bundler.

### Network data and layout

- The data array exported by `data/vocabulary.mjs` is the authoritative vocabulary for the current app. IDs are array indices. The initialPositions array is parallel to that array and came from the user’s exported coordinates. Validate word, pinyin, level and ID alignment before replacing or reordering either array.

- Edges are built at runtime from character containment, classified as prefix, suffix or infix. Entries with identical characters and different pinyin receive a separate different-reading link and a ◈ mark. These are spelling-based links, not verified semantic relationships.

- The network uses the imported positions as a starting layout, runs vis-network physics, then automatically freezes after ten seconds and separates bounding boxes. Pause and Resume arrangement remains available. The loading overlay and inert sidebar clear when the initial network is ready; Practice quiz can be requested while it is loading.

### Browsing and audio

The sidebar supports tone-insensitive pinyin search, sorting, HSK filters, a different-reading filter and link counts. HSK 1–4 have distinct colors. Selecting a node highlights its direct links. Show all restores the network view while preserving the active filters.

The Speak button sends the selected Chinese characters to the unofficial Google Translate TTS endpoint with a Mandarin locale; example sentence playback sends the full sentence. This needs internet access and does not save audio files. A 700 ms delay is applied before playback. For polyphonic characters, the service can choose a different pronunciation from the selected entry; it is not a guaranteed pinyin-controlled voice.

## Sentences and quiz

### Sentence loading

`data/sentence-index.mjs` stores localSentenceData.byWord as word → sentence-ID arrays; it does not embed the sentence text. The source file has five TSV columns: ID, simplified Chinese, traditional Chinese, pinyin and English. At last inspection the index covered 1,944 written words and 23,772 unique sentence IDs, with up to 20 IDs per word; the Examples panel displays up to five.

Loading order is: cmn_sen_db_2.tsv beside the served HTML, then the raw GitHub source, then a user-selected TSV if both fail. The TSV parser loads referenced rows into memory and rejects a file with missing indexed IDs. The source is approximately 10 MB. Pinyin and translations in that corpus were automatically generated and may be inaccurate; character-substring matches can represent a different sense or reading. Some words have fewer than five sentences or none.

### Quiz behavior

Quiz opens a dedicated full-screen view from the header, including its own HSK level selectors. Modes are character to translation, translation to character, character to tone-marked pinyin, fill in the sentence and mixed. Quiz setup is hidden during a test and can be reopened. Distractors favor linked words, similar spellings or readings, shared translation tokens and the same level; semantic ambiguity can still occur.

Sentence questions are generated on demand from indexed examples. One or sometimes two words are blanked; in the current version a two-blank question uses one combined answer choice. The user can reveal pinyin with the target readings masked or the full English translation. Some entries are excluded from character-only prompts when multiple readings make the answer ambiguous. Questions are not pregenerated.

### Stored progress

Quiz answers are written to browser IndexedDB database hsk-word-quiz, object store wordProgress. The stable key is JSON.stringify([characters, normalized lower-case pinyin]); records include correct and incorrect counts, counts by mode, HSK level and the last result and timestamp. Both missing words in a sentence question receive the outcome of the combined answer. Do not clear or silently migrate progress. If the database fails, the UI reports that progress could not be saved.

## Flashcards

The header Flashcards button opens a dedicated review screen. Users must select one or more HSK levels before starting. Review can include new and due cards (default) or all words in those levels, with a session size of 20, 50, or all matching cards. Cards show characters first; Show answer reveals pinyin, part of speech, and meaning.

Review again repeats the card later in the current session, resets its remembered streak, and schedules it in five minutes. Remembered schedules the next review after 1, 3, 7, 14, then 30 days, based on consecutive remembered ratings. Each rating is saved immediately. Ending or reloading a session preserves completed ratings; the next session is built from the saved schedule rather than resuming the exact queue.

Local-only flashcard progress uses a separate IndexedDB database, `hsk-word-flashcards`, version 1, object store `cardProgress`. Keys are JSON.stringify([characters, normalized lower-case pinyin]), retaining distinct readings. Records include review counts, remembered/again counts, streak, interval, last review, and next due date. Existing quiz progress is unchanged. If loading storage fails, review stays disabled; if saving fails, the current card remains available for retry. Progress belongs to the browser profile and site origin.

## Feature chooser and grammar explorer

The page starts with a feature chooser: Word explorer (word mapping), Statistics, Flashcards, Quiz, Cloud sync, and Grammar explorer. Each feature is a regular page view with a hash route (`#explorer`, `#statistics`, `#flashcards`, `#quiz`, `#cloud`, `#grammar`); `#home` returns to the chooser. Every page shares a consistent title, browser-tab title, Back to home link, and cloud sync indicator. Browser back/forward navigation works across routes. Statistics is a full page, including when opened for a selected word from the map. Its All words control returns to the statistics overview; the shared Back to home link always returns to the chooser.

`assets/js/shell.mjs` owns navigation and lazy loading. `assets/js/features.mjs` shares account progress and study controllers without constructing the word map. The network library, coordinates, and network UI load only for Word explorer. Quiz builds its vocabulary relationships independently of vis-network. Grammar does not load the vocabulary or network library. The shared cloud status service starts independently on Home and remains active across all pages. The existing progress databases and Firebase schema are unchanged.

Grammar explorer reads `data/hsk-1-6-grammar.tsv` on demand. The source currently contains 692 entries across HSK 1-6 (59, 61, 77, 172, 209, and 114 respectively). It has nine columns: HSK, Code, Lesson, Structure, Pinyin, English Equivalent, Example, Example Pinyin, Example Translation. Entries with repeated lesson codes remain separate. The one entry with an empty structure describes omitting ?; its English explanation is used as the display title while the original data remains unchanged.

Users can search structures, tone-insensitive pinyin, English meanings, examples, and lesson codes, and filter by HSK level. The list displays 30 entries per page. Selecting an entry shows its structure, reading, explanation, and Chinese example with pinyin and translation. Play example uses the existing online speech player. On phones, details replace the result list and Back to grammar list restores the current filters/page. Grammar data is read-only and does not create progress records.

Grammar logic and interface live in `assets/js/grammar-model.mjs` and `assets/js/grammar.mjs`; styles are in `assets/css/grammar.css`. The chooser uses `assets/css/features.css`. Publish these assets and the grammar TSV along with the other runtime files.

### Shared page navigation and status

`assets/js/cloud-service.mjs` initializes a single cloud controller for the entire page, without requiring vocabulary data on Home. `assets/js/cloud-status.mjs` renders checking, off, signed-out, pending, syncing, synced, unavailable, and signed-in/offline states in the shared status bar. Firebase still loads only when enabled in the public configuration. Vocabulary metadata is attached later when study features initialize, or loaded on demand when importing existing local history from the Cloud sync page. The existing account caches, outbox, and Firestore data format are unchanged.

Quiz menu initialization does not load the sentence index or initialize example controls. These optional resources load only when a sentence or mixed quiz is started. Translation, character, and pinyin quizzes can start without them. The Home-to-Quiz route and question generation are covered by a regression test that deliberately makes sentence loading unavailable.

The Word explorer page header contains only its title and Back to home navigation. Mobile Browse words, word statistics, speech, and examples are in a separate toolbar below the selected-word title. The previous feature-launch controls remain hidden for controller compatibility. Statistics, Quiz, Flashcards, and Cloud sync use regular page containers so the shared header and status bar remain visible. `assets/css/pages.css` supplies these shared page layouts.

## Word statistics

Statistics on Home opens a searchable, paginated page for every vocabulary entry. Select a word in the network or sidebar and use Stats in the toolbar below the selected word to open its statistics directly. Different readings of the same characters keep separate histories.

The overview supports HSK level, practiced/unpracticed, and due-flashcard filters, with sorting by practice count, quiz accuracy, due date, or pinyin. Summary accuracy is calculated from total correct answers divided by total answers, not the average of individual word percentages. Word details show quiz counts and accuracy by mode, the last quiz answer, flashcard remembered/again counts, the current streak, last review, and next scheduled review. Unpracticed words have no accuracy percentage.

Statistics are computed from existing progress and do not introduce a new storage schema. Signed-out stats read the original local-only quiz and flashcard databases without creating empty databases. Signed-in stats use only that account's IndexedDB cache, reading cached bucket documents once for both quiz and flashcards; opening stats makes no extra Firestore requests. Local-only history is not mixed into account history unless explicitly imported through Cloud sync. Open stats refresh on account changes, cloud updates, successful ratings, and window focus. The Refresh button can be used to re-evaluate due times or retry an unavailable store. Storage failures are shown as errors rather than zero progress.

The UI is in `assets/js/stats.mjs`, calculations and filtering in `assets/js/stats-model.mjs`, and responsive styles in `assets/css/stats.css`. The table renders 50 rows at a time and keeps the word column visible during horizontal scrolling on small screens.

## Firebase cloud sync

Cloud sync supports Google sign-in and shares quiz and flashcard progress across devices. The frontend remains static and works on GitHub Pages. Local-only review remains available when Firebase is disabled or unavailable. The integration code is `assets/js/cloud-sync.mjs`; its public configuration is `data/firebase-config.json`.

### Firebase setup

1. Create a Firebase project on the no-cost Spark plan and register a Web app. Analytics is not needed. Copy the public Firebase Web configuration from Project settings.
2. In Authentication, enable the Google provider and select the support email. Under Settings > Authorized domains, add the site's exact hostname, such as `YOUR_USERNAME.github.io`, plus a custom hostname if used. Add `localhost` and/or `127.0.0.1` explicitly for local testing. Domains do not include the repository path.
3. Create a Cloud Firestore Standard edition database in a suitable region. Start with restrictive production rules.
4. Publish `firestore.rules` and `firestore.indexes.json`. With Firebase CLI authentication configured, run `npx firebase-tools deploy --only firestore --project YOUR_PROJECT_ID`. This command does not deploy the website. For an existing shared Firebase project, merge these rules and index exemptions with the existing configuration rather than replacing unrelated rules.
5. Fill `data/firebase-config.json`: copy `apiKey`, `authDomain`, `projectId`, and `appId` into `firebaseConfig`, and set `enabled` to `true`. These are public client identifiers. Never add service-account keys or Admin SDK credentials to the repository.
6. Publish `index.html`, `assets/`, and `data/` to GitHub Pages, or run `python serve.py` locally. Open Cloud sync and sign in with the same Google account on both devices. Use Sync now before switching devices.

The Cloud sync page shows account and sync status. The shared status bar also appears on Home and every other feature page. Local-only history is not uploaded automatically: the user can explicitly import it once per browser and account. Import preserves both original local databases. Signing out returns to local-only history; account caches and pending uploads remain isolated by UID. Unsent account changes retry the next time that account is signed in and connected. Use a modern browser with IndexedDB, Web Locks, and ES module support. The public configuration ships disabled until a real project is connected.

### Storage design and efficiency

- Firestore path: `users/{uid}/progress/{deviceId}_{kind}_{bucket}`. Rules require the authenticated UID to match the owner; there is no public progress access. Kind is `q` (quiz) or `f` (flashcards), with four deterministic buckets each. Only buckets actually used are created: at most eight documents per device for the current vocabulary.
- Store only stable character/reading keys and compact numeric progress arrays. Vocabulary, meanings, pinyin display strings, HSK labels, sentences, and individual answer events are not duplicated in the cloud. Quiz rows contain totals, last answer, and counts for the four quiz modes; flashcard rows contain totals and the current schedule. Display metadata is reconstructed from the vocabulary module.
- Ratings first commit atomically to the account-scoped IndexedDB database `hsk-word-cloud`, with `documents`, `pending`, and `meta` stores. Pending updates survive page reloads and offline sessions. A ten-second window combines repeated answers, sending only changed fields in dirty buckets in a Firestore batch. Manual sync and page hiding also attempt a flush; page-close delivery is not assumed.
- A single live collection listener receives bucket changes. Firestore's persistent cache and multiple-tab manager share cached reads; the app does not poll or read one document per word. New devices initially read the existing bucket documents. Returning sessions may still incur Firestore reads according to its cache/reconnection billing behavior.
- Each device maintains its own monotone counters. Retry and duplicate snapshots merge by maximum within a device, and totals sum across devices. Offline reviews on two devices do not overwrite each other's counts. Flashcard scheduling uses the latest per-card review timestamp, with device ID breaking ties; simultaneous offline reviews cannot establish a shared review order. Correct device clocks are recommended.
- Web Locks serialize flushes across tabs. An upload acknowledgement clears the outbox only when its revision still matches, so new answers saved during an upload are retained. All progress fields are exempted from automatic Firestore indexing because the app reads documents without field queries.

No Firebase project or deployed rules are created automatically. Live Google sign-in, access rules, and cross-device behavior must be verified against the configured project. Free service quotas still apply.

### Development checks

The application does not require npm to run. The development-only `fake-indexeddb` dependency exercises persistence and concurrency without a browser. Run `npm ci` followed by `npm test` for data-model, IndexedDB, module, and data-integrity regression tests. Run `python -m unittest discover -s tests -p "test_*.py"` for HTTP asset delivery, JavaScript MIME types, and path restrictions. Browser and live-Firebase testing are separate manual checks.

Official references: [Web setup](https://firebase.google.com/docs/web/setup), [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [offline persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [index exemptions](https://firebase.google.com/docs/firestore/query-data/index-overview).

## Adding words or features

### When a new HSK list is provided

- Inspect the TSV schema, encoding, row count and missing fields. Existing numbered source lists are number, characters, pinyin, part of speech and meaning; the existing combined export omits the number and appends the source level.

- Deduplicate only entries with the same written characters and the same normalized reading. Preserve different readings as separate entries. Merge distinct meanings with numbering; retain the earliest existing HSK level unless the user directs otherwise.

- Update `data/vocabulary.mjs` and `data/initial-positions.mjs` together. Match saved coordinates by stable word and reading, not by position alone. Supply sensible initial positions for new nodes; check the whole mapping and lengths before releasing.

- Add the level to colors, legends, sidebar filters and quiz level selectors. Rebuild and validate the word-to-sentence-ID index from the original TSV; reuse sentence IDs instead of duplicating sentence text. Recalculate coverage and report missing examples.

- Review alternate-reading links, search, sorting, quiz eligibility and IndexedDB keys. Preserve existing IDs only when safe; stored progress is keyed by word and pinyin rather than array index.

### When implementing a feature

Inspect the current HTML and the relevant feature modules before editing. The network coordinator is `assets/js/app.mjs`; feature code and styles live alongside it. Preserve the vendor bundle and its license. When the original sentence file changes, rebuild the index from that exact file: reusing IDs with a different corpus can produce wrong sentences even if the IDs exist.

## Verification and known limits

- Run JavaScript syntax checks on the modified modules and `npm test`. Validate row counts, unique character-and-pinyin keys, coordinate alignment and sentence-ID coverage. Exercise all HSK filters and all quiz modes, including two blanks, progress persistence, resume and fallback loading.

- Test in a real browser where possible: initial loading and quiz during loading, local/remote/upload fallback, example playback, screen sizing, IndexedDB and network pause/resume. Previous work used mocked tests and syntax checks; browser rendering, Google playback and pronunciation were not verified in this environment.

- The raw GitHub fallback and unofficial TTS endpoint depend on external availability. Audio requests send the selected characters or sentence to Google. Avoid asserting that generated translations, readings or distractors are linguistically verified.

Current scratch scripts and file paths are temporary. Use the current user-provided files and the linked deliverables as the working source; do not assume a previous workspace will persist.
