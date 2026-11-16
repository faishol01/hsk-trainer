"""Generate character/component relationships from the original HSK TSV.

Run from any directory: python src/generate_character_relationships.py
Uses the cached Make Me a Hanzi dictionary; no Python dependencies required.
"""

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from itertools import combinations
from pathlib import Path
import unicodedata


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://github.com/skishore/makemeahanzi"
# Positional forms of the same component, used only for comparing components.
VARIANTS = dict(zip("亻氵忄扌灬犭礻衤饣钅纟讠刂", "人水心手火犬示衣食金丝言刀"))
STROKES = set("一丨丿丶乀乁乙乚乛亅〇？")
# Explicit study pairs, not an automatic inference from equal stroke counts.
VISUAL_PAIRS = {
    "千干": "Similar outline; the upper stroke differs in direction.",
    "无天": "Similar outline; the lower-right stroke differs in shape.",
    "土士": "The relative lengths of the horizontal strokes differ.",
    "未末": "The relative lengths of the horizontal strokes differ.",
    "己已": "The height of the opening differs.",
    "日目": "One additional inner horizontal stroke.",
    "大太": "One additional dot stroke.",
    "木本": "One additional short horizontal stroke.",
    "王玉": "One additional dot stroke.",
    "乌鸟": "One additional short stroke in the upper part.",
}


def is_hanzi(char):
    return unicodedata.name(char, "").startswith("CJK UNIFIED IDEOGRAPH")


def canonical(char):
    return VARIANTS.get(char, char)


def generate(input_path, dictionary_path, output_dir):
    words_by_character = defaultdict(dict)
    row_count = 0
    with input_path.open(encoding="utf-8-sig", newline="") as source:
        for line_number, row in enumerate(csv.reader(source, delimiter="\t"), 1):
            if not row:
                continue
            if len(row) != 5 or not row[0].strip():
                raise ValueError(f"Invalid five-column vocabulary row: {line_number}")
            word, pinyin, pos, meaning, level = row
            row_count += 1
            record = dict(word=word, pinyin=pinyin, part_of_speech=pos,
                          meaning=meaning, level=level)
            for character in set(word):
                if is_hanzi(character):
                    words_by_character[character][(word, pinyin, level)] = record

    dictionary = {}
    with dictionary_path.open(encoding="utf-8") as source:
        for line in source:
            if line.strip():
                entry = json.loads(line)
                dictionary[entry["character"]] = entry

    characters = []
    component_members = defaultdict(set)
    missing = []
    for character in sorted(words_by_character):
        entry = dictionary.get(character, {})
        decomposition = entry.get("decomposition", "")
        # IDS operators describe arrangement; leaf ideographs are components.
        # Keep recognizable leaves even when another part is marked unknown.
        components = {canonical(c) for c in decomposition
                      if is_hanzi(c) and c not in STROKES and c != character}
        components.discard(canonical(character))
        # Include the character itself: 马 then links to 妈/吗 containing 马.
        for component in components | {canonical(character)}:
            component_members[component].add(character)
        if not entry or "？" in decomposition:
            missing.append(character)
        characters.append(dict(
            character=character, decomposition=decomposition or None,
            decomposition_complete=bool(entry) and "？" not in decomposition,
            components=sorted(components), pinyin=entry.get("pinyin", []),
            stroke_count=len(entry["matches"]) if "matches" in entry else None,
            words=list(words_by_character[character].values()),
        ))

    edges = {}

    def edge_for(a, b):
        a, b = sorted((a, b))
        return edges.setdefault((a, b), dict(source=a, target=b,
                                            shared_components=[], visual_notes=[]))

    for component, members in sorted(component_members.items()):
        for a, b in combinations(sorted(members), 2):
            edge_for(a, b)["shared_components"].append(component)
    for pair, note in VISUAL_PAIRS.items():
        a, b = pair
        if a in words_by_character and b in words_by_character:
            edge_for(a, b)["visual_notes"].append(note)

    relationships = []
    for _, edge in sorted(edges.items()):
        edge["types"] = []
        if edge["shared_components"]:
            edge["types"].append("shared_component")
            endpoints = {canonical(edge["source"]), canonical(edge["target"])}
            if endpoints.intersection(edge["shared_components"]):
                edge["types"].append("component_containment")
        if edge["visual_notes"]:
            edge["types"].append("visual_similarity")
        relationships.append(edge)

    result = dict(
        metadata=dict(
            input=input_path.name, input_sha256=hashlib.sha256(input_path.read_bytes()).hexdigest(),
            vocabulary_rows=row_count, character_count=len(characters),
            relationship_count=len(relationships),
            dictionary_source=SOURCE_URL,
            dictionary_sha256=hashlib.sha256(dictionary_path.read_bytes()).hexdigest(),
            dictionary_license="LGPL-3.0-or-later",
            incomplete_decomposition_characters=missing,
            component_variants=VARIANTS,
            method="Shared nontrivial IDS leaf components, component containment, and explicit visual study pairs.",
            limitations="Shape-based study links, not semantic or etymological claims. Single-stroke components are excluded. Visual pairs are curated and not exhaustive. No recursive decomposition or stroke geometry comparison is performed.",
        ), characters=characters, relationships=relationships,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "character-relationships.json"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output_dir / "character-relationships.tsv").open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter="\t")
        writer.writerow(["source", "target", "types", "shared_components", "visual_notes"])
        for edge in relationships:
            writer.writerow([edge["source"], edge["target"], ",".join(edge["types"]),
                             ",".join(edge["shared_components"]), " | ".join(edge["visual_notes"])])
    print(f"Read {row_count} words; generated {len(characters)} characters and {len(relationships)} relationships.")
    print(f"Missing or partial decompositions: {len(missing)} (listed in JSON metadata)")
    print(f"Output: {json_path}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/hsk-1-4-words.tsv")
    parser.add_argument("--dictionary", type=Path, default=ROOT / "data/character-source/dictionary.jsonl")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    generate(args.input, args.dictionary, args.output_dir)


if __name__ == "__main__":
    main()
