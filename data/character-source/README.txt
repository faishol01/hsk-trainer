Character decomposition source
==============================
dictionary.jsonl is an unmodified copy of dictionary.txt from:
https://github.com/skishore/makemeahanzi
https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt
Downloaded 2026-11-10. The generator records a SHA-256 digest in its output.

The dictionary is distributed under LGPL-3.0-or-later; see COPYING and LGPL.
It derives from Unihan and CJKlib, as described in upstream COPYING.

Regenerate the output from the workspace root:
  python src/generate_character_relationships.py

Output: data/character-relationships.json and data/character-relationships.tsv
JSON includes unique characters, source vocabulary rows, decompositions,
component lists, stroke counts, and explained undirected relationships.
TSV contains one row per unique character pair.

Shared components are extracted from the dictionary's IDS decompositions.
Positional variants (for example, person radical and person) are normalized
for comparison. Isolated stroke components are excluded to avoid linking
almost every character. Component comparisons are not semantic claims.
Explicit visual study pairs supplement the component links, including
the user-provided 千/干 and 无/天 examples. These pairs are not exhaustive;
the generator does not claim to compare actual stroke geometry.
