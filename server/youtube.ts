const YT_API_KEY = process.env.YOUTUBE_API_KEY!;
const YT_BASE = "https://www.googleapis.com/youtube/v3";

// Write YouTube cookies to a temp file once if YOUTUBE_COOKIES env var is set.
// The env var should contain the full Netscape-format cookies.txt content.
let cookiesFilePath: string | null = null;
async function getCookiesArgs(): Promise<string[]> {
  if (!process.env.YOUTUBE_COOKIES) return [];
  if (cookiesFilePath) return ["--cookies", cookiesFilePath];
  const { promises: fs } = await import("fs");
  const { default: os } = await import("os");
  const { default: path } = await import("path");
  cookiesFilePath = path.join(os.tmpdir(), "yt-cookies.txt");
  await fs.writeFile(cookiesFilePath, process.env.YOUTUBE_COOKIES, "utf-8");
  return ["--cookies", cookiesFilePath];
}

export interface VideoInfo {
  id: string;
  title: string;
  publishedAt: string;
  thumbnail: string;
}

export interface ChannelInfo {
  channelId: string;
  channelTitle: string;
  thumbnail: string;
}

export async function getChannelInfoFromVideo(videoId: string): Promise<ChannelInfo> {
  const url = `${YT_BASE}/videos?id=${videoId}&part=snippet&key=${YT_API_KEY}`;
  const res = await fetch(url);
  const json = await res.json() as any;
  if (json.error) throw new Error(json.error.message);
  const item = json.items?.[0];
  if (!item) throw new Error("Video not found");
  return {
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.default?.url ?? "",
  };
}

export async function getChannelVideos(
  channelId: string,
  startDate: string,
  endDate: string
): Promise<VideoInfo[]> {
  const after = new Date(startDate).toISOString();
  // Include the full end day
  const endObj = new Date(endDate);
  endObj.setHours(23, 59, 59, 999);
  const before = endObj.toISOString();

  const url =
    `${YT_BASE}/search?channelId=${channelId}&type=video&order=date` +
    `&publishedAfter=${after}&publishedBefore=${before}` +
    `&maxResults=50&part=snippet&key=${YT_API_KEY}`;

  const res = await fetch(url);
  const json = await res.json() as any;
  if (json.error) throw new Error(json.error.message);
  if (!json.items?.length) return [];

  // One video per day — latest per day
  const byDay = new Map<string, VideoInfo>();
  for (const item of json.items) {
    const publishedAt: string = item.snippet.publishedAt;
    const day = publishedAt.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, {
        id: item.id.videoId,
        title: item.snippet.title,
        publishedAt,
        thumbnail: item.snippet.thumbnails?.medium?.url ?? "",
      });
    }
  }

  return Array.from(byDay.values()).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

export async function getTranscript(
  videoId: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  // Step 1: Try auto-generated captions (fast, ~2 seconds)
  try {
    const transcript = await getTranscriptViaCaptions(videoId);
    if (transcript) return transcript;
  } catch (e: any) {
    console.log(`[transcript] No captions for ${videoId}: ${e.message}`);
  }

  // Step 2: Download audio + Whisper transcription (~3-8 minutes on CPU)
  onProgress?.("📥 No captions found — downloading audio for Whisper transcription (this takes a few minutes)...");
  return transcribeViaWhisper(videoId, onProgress);
}

async function getTranscriptViaCaptions(videoId: string): Promise<string> {
  const { spawn } = await import("child_process");
  const { promises: fs } = await import("fs");
  const { default: path } = await import("path");
  const { default: os } = await import("os");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `yt-caps-${videoId}-`));
  const outputTemplate = path.join(tmpDir, "%(id)s");

  try {
    const cookiesArgs = await getCookiesArgs();
    let stderr = "";
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("yt-dlp", [
        `https://www.youtube.com/watch?v=${videoId}`,
        "--write-auto-subs",
        "--write-subs",
        "--sub-langs", "ko.*,ko",
        "--skip-download",
        "--sub-format", "vtt",
        "-o", outputTemplate,
        "--no-playlist",
        "--extractor-args", "youtube:player_client=android,mweb",
        ...cookiesArgs,
      ]);
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.stdout?.on("data", () => {}); // drain stdout
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(0, 300)}`));
      });
      proc.on("error", reject);
    });

    const files = await fs.readdir(tmpDir);
    const vttFile = files.find((f) => f.endsWith(".vtt"));
    if (!vttFile) throw new Error("No VTT subtitle file found");

    const vttContent = await fs.readFile(path.join(tmpDir, vttFile), "utf-8");
    return parseVtt(vttContent);
  } finally {
    const { promises: fs2 } = await import("fs");
    await fs2.rm(tmpDir, { recursive: true, force: true });
  }
}

async function transcribeViaWhisper(
  videoId: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const { spawn } = await import("child_process");
  const { promises: fs } = await import("fs");
  const { default: path } = await import("path");
  const { default: os } = await import("os");
  const { fileURLToPath } = await import("url");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `yt-audio-${videoId}-`));
  const audioPath = path.join(tmpDir, `${videoId}.mp3`);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const whisperScript = path.join(__dirname, "whisper_transcribe.py");

  try {
    const cookiesArgs = await getCookiesArgs();
    // Download audio
    onProgress?.("📥 Downloading audio...");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("yt-dlp", [
        `https://www.youtube.com/watch?v=${videoId}`,
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "5",   // 128kbps — good enough for speech
        "-o", audioPath,
        "--no-playlist",
        "--extractor-args", "youtube:player_client=android,mweb",
        ...cookiesArgs,
      ]);
      let stderr = "";
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.stdout?.on("data", () => {});
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Audio download failed (code ${code}): ${stderr.slice(0, 300)}`));
      });
      proc.on("error", reject);
    });

    onProgress?.("🎙️ Running Whisper transcription (Korean)... this may take a few minutes");

    const transcript = await new Promise<string>((resolve, reject) => {
      const proc = spawn("python3", [whisperScript, audioPath]);
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0 && stdout.trim()) resolve(stdout.trim());
        else reject(new Error(`Whisper failed (code ${code}): ${stderr.slice(0, 300)}`));
      });
      proc.on("error", reject);
    });

    return transcript;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function parseVtt(vtt: string): string {
  const lines = vtt.split("\n");
  const texts: string[] = [];
  let capturing = false;

  for (const raw of lines) {
    const line = raw.trim();

    // Skip header/metadata lines
    if (
      line.startsWith("WEBVTT") ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:") ||
      line === ""
    ) {
      capturing = false;
      continue;
    }

    // Timestamp line — next lines are caption text
    if (line.includes("-->")) {
      capturing = true;
      continue;
    }

    if (capturing && line) {
      // Remove inline timestamp tags like <00:00:01.234> and <c> </c>
      const cleaned = line
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .trim();
      if (cleaned) texts.push(cleaned);
    }
  }

  // Deduplicate consecutive identical lines (common in YT auto-subs)
  const deduped = texts.filter((t, i) => i === 0 || t !== texts[i - 1]);
  return deduped.join(" ").replace(/\s+/g, " ").trim();
}
