#!/usr/bin/env python3
"""
Fetch Korean transcript from a YouTube video using youtube_transcript_api.
Usage: python3 fetch_transcript.py <video_id>
Prints transcript text to stdout, exits 1 if no transcript found.
"""
import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: fetch_transcript.py <video_id>", file=sys.stderr)
        sys.exit(1)

    video_id = sys.argv[1]

    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable

    try:
        # Try Korean first, then fall back to any available language
        try:
            entries = YouTubeTranscriptApi.get_transcript(video_id, languages=["ko", "ko-KR"])
        except NoTranscriptFound:
            # Get whatever is available and note it
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            transcript = transcript_list.find_generated_transcript(["ko", "ko-KR", "en"])
            entries = transcript.fetch()

        text = " ".join(entry["text"].strip() for entry in entries if entry["text"].strip())
        print(text)

    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable) as e:
        print(f"No transcript available: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
