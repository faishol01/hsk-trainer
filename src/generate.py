import asyncio
import os
import re
import pandas as pd
from tqdm import tqdm
import edge_tts
from pydub import AudioSegment

# ================= CONFIGURATION =================
START_DELAY_MS = 500  # Silence at the beginning (500ms = 0.5s)
END_DELAY_MS = 800    # Silence at the end (800ms = 0.8s)
OUTPUT_DIR = "hsk_audio"
INPUT_FILE = "hsk-combined.tsv"
VOICE = "zh-CN-XiaoxiaoNeural"  # "zh-CN-XiaoxiaoNeural" (Female) or "zh-CN-YunxiNeural" (Male)
# =================================================

# Contextual hints for polyphonic words (多音字) to ensure correct tones are spoken
POLYPHONE_CONTEXT = {
    ("地", "de"): "快快地",        # Adverbial particle (neutral tone)
    ("地", "dì"): "地面",          # Earth/ground (4th tone)
    ("得", "de"): "跑得快",        # Structural particle (neutral tone)
    ("得", "děi"): "得去",         # Must/have to (3rd tone)
    ("得", "dé"): "得到",          # To obtain (2nd tone)
    ("只", "zhī"): "一只",         # Measure word (1st tone)
    ("只", "zhǐ"): "只有",         # Only/merely (3rd tone)
}

def sanitize_filename(filename):
    """Remove illegal characters for file systems."""
    return re.sub(r'[\\/*?:"<>|]', "", filename)

async def generate_raw_audio(text_to_speak, voice, temp_path):
    """Generates the raw audio file from the TTS engine."""
    communicate = edge_tts.Communicate(text=text_to_speak, voice=voice)
    await communicate.save(temp_path)

def add_silence_padding(file_path, start_ms, end_ms):
    """Loads an audio file, adds silence padding, and saves it back."""
    # Load the generated audio
    audio = AudioSegment.from_mp3(file_path)
    
    # Create silent segments
    start_silence = AudioSegment.silent(duration=start_ms)
    end_silence = AudioSegment.silent(duration=end_ms)
    
    # Combine silence + audio + silence
    padded_audio = start_silence + audio + end_silence
    
    # Export back to MP3
    padded_audio.export(file_path, format="mp3")

async def main():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # Read tab-separated HSK vocabulary
    try:
        df = pd.read_csv(
            INPUT_FILE,
            sep='\t',
            names=['word', 'pinyin', 'pos', 'meaning', 'level'],
            keep_default_na=False
        )
    except Exception as e:
        print(f"Error reading {INPUT_FILE}: {e}")
        return
    
    print(f"Loaded {len(df)} words. Generating natural Mandarin audio with custom delays...")

    # Iterate through each HSK word
    for idx, row in enumerate(tqdm(df.itertuples(), total=len(df), desc="Generating")):
        word = str(row.word).strip()
        pinyin = str(row.pinyin).strip()
        level = str(row.level).strip()

        # Format filename: e.g. 0001_hsk-1_爱_ài.mp3
        file_num = f"{idx + 1:04d}"
        safe_pinyin = sanitize_filename(pinyin)
        safe_word = sanitize_filename(word)
        filename = f"{file_num}_{level}_{safe_word}_{safe_pinyin}.mp3"
        filepath = os.path.join(OUTPUT_DIR, filename)

        # Skip already processed files to support resuming
        if os.path.exists(filepath):
            continue

        # Use polyphone context if applicable, else use the raw word
        text_to_speak = POLYPHONE_CONTEXT.get((word, pinyin), word)

        # Temporary path to save raw TTS audio before padding
        temp_filepath = filepath + ".tmp.mp3"

        try:
            # 1. Generate the raw vocal audio
            await generate_raw_audio(text_to_speak, VOICE, temp_filepath)
            
            # 2. Add exact silence padding at beginning and end
            add_silence_padding(temp_filepath, START_DELAY_MS, END_DELAY_MS)
            
            # 3. Rename to final destination
            os.rename(temp_filepath, filepath)
            
        except Exception as e:
            if os.path.exists(temp_filepath):
                os.remove(temp_filepath)
            print(f"\nError on row {idx + 1} ({word} - {pinyin}): {e}")

    print(f"\nSuccess! All padded audio files are saved in: '{OUTPUT_DIR}/'")

if __name__ == "__main__":
    asyncio.run(main())
