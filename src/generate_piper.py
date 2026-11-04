import os
import re
import wave
import pandas as pd
import pypinyin
from tqdm import tqdm
from piper_plus.voice import PiperVoice

# ================= CONFIGURATION =================
INPUT_FILE = "hsk-combined.tsv"
OUTPUT_DIR = "hsk_audio_piper4"

# Point to your downloaded piper-plus multilingual model
MODEL_PATH = "./models/tsukuyomi.onnx"
CONFIG_PATH = "./models/tsukuyomi.onnx.json"

# Voice Pacing Adjustments
SPEECH_SPEED = 0.85  # Speed factor (e.g., 0.85 = 85% speed, which makes it very clear)
# =================================================

def sanitize_filename(filename: str) -> str:
    """Remove characters that are invalid in file names."""
    return re.sub(r'[\\/*?:"<>|]', "", filename)

def apply_exact_pinyin(word: str, pinyin_str: str):
    """
    Forces pypinyin to use the exact pronunciation and tone from Column 2.
    """
    if len(word) == 1:
        pypinyin.load_single_dict({ord(word): pinyin_str})
    else:
        syllables = pinyin_str.split()
        if len(syllables) == len(word):
            pypinyin.load_phrases_dict({word: [[s] for s in syllables]})

def add_syllable_spacing(word: str) -> str:
    """
    Inserts a subtle space/punctuation between multi-character words
    (e.g., "白天" becomes "白，天") so the neural engine doesn't rush them.
    """
    if len(word) > 1:
        return "，".join(list(word)) + "." # Use a Chinese comma as a natural short pause
    return word

def main():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    if not os.path.exists(MODEL_PATH) or not os.path.exists(CONFIG_PATH):
        print(f"Model or config not found at '{MODEL_PATH}'.")
        print("Please download the piper-plus multilingual model first.")
        return

    print(f"Loading piper-plus model: {MODEL_PATH}...")
    voice = PiperVoice.load(MODEL_PATH, config_path=CONFIG_PATH)

    # Read tab-separated HSK vocabulary
    df = pd.read_csv(
        INPUT_FILE,
        sep="\t",
        names=["word", "pinyin", "pos", "meaning", "level"],
        keep_default_na=False
    )

    print(f"Loaded {len(df)} HSK words. Generating clear, natural-paced audio...")

    for idx, row in enumerate(tqdm(df.itertuples(), total=len(df), desc="Synthesizing")):
        word = str(row.word).strip()
        pinyin = str(row.pinyin).strip()
        level = str(row.level).strip()

        file_num = f"{idx + 1:04d}"
        safe_word = sanitize_filename(word)
        safe_pinyin = sanitize_filename(pinyin)
        
        filename = f"{file_num}_{level}_{safe_word}_{safe_pinyin}.wav"
        filepath = os.path.join(OUTPUT_DIR, filename)

        # Skip already processed files
        if os.path.exists(filepath):
            continue

        try:
            # 1. Lock exact dictionary tone
            apply_exact_pinyin(word, pinyin)

            # 2. Add sub-second gaps between syllables for maximum clarity
            spaced_text = add_syllable_spacing(word)
            print(spaced_text)
            # 3. Synthesize directly to WAV at a slower, non-rushed speech rate
            with wave.open(filepath, "wb") as wav_file:
                # 'length_scale' in Piper scales speech duration. 
                # Increasing length_scale (e.g. 1.15) slows down the speech naturally.
                length_scale = 1.0 / SPEECH_SPEED  # 0.85 speed translates to ~1.18 length scale
                
                try:
                    voice.synthesize(
                        spaced_text, 
                        wav_file, 
                        language="zh", 
                        length_scale=length_scale
                    )
                except TypeError:
                    # Fallback for versions with basic parameters
                    voice.synthesize(spaced_text, wav_file, length_scale=length_scale)
                    
        except Exception as e:
            print(f"\nError on row {idx + 1} ({word} - {pinyin}): {e}")

    print(f"\nSuccess! Clear and natural HSK audio files are saved in: '{OUTPUT_DIR}/'")

if __name__ == "__main__":
    main()
