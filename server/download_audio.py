#!/usr/bin/env python3
"""
Download audio from a YouTube video using pytubefix.
Usage: python3 download_audio.py <video_id> <output_path>
"""
import sys
import os

def main():
    if len(sys.argv) < 3:
        print("Usage: download_audio.py <video_id> <output_path>", file=sys.stderr)
        sys.exit(1)

    video_id = sys.argv[1]
    output_path = sys.argv[2]
    url = f"https://www.youtube.com/watch?v={video_id}"

    from pytubefix import YouTube
    from pytubefix.cli import on_progress

    yt = YouTube(url, on_progress_callback=on_progress, use_oauth=False, allow_oauth_cache=False)

    # Get audio-only stream (smallest size)
    audio_stream = yt.streams.filter(only_audio=True).order_by("abr").first()
    if not audio_stream:
        print("No audio stream found", file=sys.stderr)
        sys.exit(1)

    # Download to a temp file then rename to expected path
    out_dir = os.path.dirname(output_path)
    downloaded = audio_stream.download(output_path=out_dir, filename="audio_tmp")

    # Convert to mp3 via ffmpeg
    import subprocess
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", downloaded, "-q:a", "5", output_path],
        capture_output=True, text=True
    )
    os.remove(downloaded)

    if result.returncode != 0:
        print(f"ffmpeg error: {result.stderr[:200]}", file=sys.stderr)
        sys.exit(1)

    print(f"Downloaded: {output_path}")

if __name__ == "__main__":
    main()
