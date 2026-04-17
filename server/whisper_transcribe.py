#!/usr/bin/env python3
"""
Transcribe an audio file to Korean text using faster-whisper.
Usage: python3 whisper_transcribe.py <audio_file_path>
Prints the Korean transcript to stdout.
"""
import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: whisper_transcribe.py <audio_file>", file=sys.stderr)
        sys.exit(1)

    audio_file = sys.argv[1]
    if not os.path.exists(audio_file):
        print(f"File not found: {audio_file}", file=sys.stderr)
        sys.exit(1)

    from faster_whisper import WhisperModel

    # base model: 145MB, ~5x real-time on CPU — good balance for Korean
    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(audio_file, language="ko", beam_size=5)

    text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())
    print(text)

if __name__ == "__main__":
    main()
