const YT_API_KEY = process.env.YOUTUBE_API_KEY!;
const YT_BASE = "https://www.googleapis.com/youtube/v3";

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
  // Step 1: youtube_transcript_api (Python) — fetches captions directly, works on server IPs
  try {
    const transcript = await getTranscriptViaPythonApi(videoId);
    if (transcript) return transcript;
  } catch (e: any) {
    console.log(`[transcript] Python API failed for ${videoId}: ${e.message}`);
  }

  // Step 2: AssemblyAI — upload audio and transcribe via cloud ASR
  if (process.env.ASSEMBLYAI_API_KEY) {
    onProgress?.("📥 No captions found — downloading audio for AssemblyAI transcription...");
    try {
      return await transcribeViaAssemblyAI(videoId, onProgress);
    } catch (e: any) {
      console.log(`[transcript] AssemblyAI failed for ${videoId}: ${e.message}`);
    }
  }

  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error("No captions found and ASSEMBLYAI_API_KEY is not set — cannot transcribe audio");
  }
  throw new Error("No transcript available — captions not found and audio transcription failed");
}

// ── Step 1: youtube_transcript_api (Python) ──────────────────────────────────
async function getTranscriptViaPythonApi(videoId: string): Promise<string> {
  const { spawn } = await import("child_process");
  const { default: path } = await import("path");
  const { fileURLToPath } = await import("url");

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(__dirname, "fetch_transcript.py");

  return new Promise<string>((resolve, reject) => {
    const proc = spawn("python3", [script, videoId]);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `exit code ${code}`));
    });
    proc.on("error", reject);
  });
}

// ── Step 2: AssemblyAI via Invidious audio URL ───────────────────────────────
// Invidious returns direct googlevideo.com URLs — no download on Railway needed.
// AssemblyAI fetches the audio directly from its own servers.
async function getAudioUrlFromInvidious(videoId: string, onProgress?: (msg: string) => void): Promise<string> {
  const instances = [
    "https://iv.ggtyler.dev",
    "https://invidious.perennialte.ch",
    "https://yt.drgnz.club",
    "https://invidious.nerdvpn.de",
    "https://invidious.fdn.fr",
  ];

  for (const instance of instances) {
    try {
      onProgress?.(`🔗 Trying Invidious: ${instance}...`);
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        onProgress?.(`  ↳ HTTP ${res.status}`);
        continue;
      }
      const data = await res.json() as any;
      const audioFormats: any[] = [
        ...(data.adaptiveFormats ?? []),
        ...(data.formatStreams ?? []),
      ].filter((f: any) => f.url && (f.type?.startsWith("audio/") || f.audioQuality));
      if (!audioFormats.length) {
        onProgress?.(`  ↳ No audio streams in response`);
        continue;
      }
      audioFormats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      onProgress?.(`  ↳ Got audio URL`);
      return audioFormats[0].url;
    } catch (e: any) {
      onProgress?.(`  ↳ Error: ${e.message}`);
    }
  }

  // Try Piped API
  try {
    onProgress?.(`🔗 Trying Piped API...`);
    const res = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      const audioStreams: any[] = data.audioStreams ?? [];
      if (audioStreams.length > 0) {
        audioStreams.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
        onProgress?.(`  ↳ Got audio URL from Piped`);
        return audioStreams[0].url;
      }
    }
    onProgress?.(`  ↳ Piped HTTP ${res.status}`);
  } catch (e: any) {
    onProgress?.(`  ↳ Piped error: ${e.message}`);
  }

  // Try Cobalt API (cobalt.tools) — maintained public media downloader
  try {
    onProgress?.(`🔗 Trying Cobalt API...`);
    const res = await fetch("https://api.cobalt.tools/", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        downloadMode: "audio",
        audioFormat: "mp3",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      if ((data.status === "redirect" || data.status === "tunnel") && data.url) {
        onProgress?.(`  ↳ Got audio URL from Cobalt`);
        return data.url;
      }
      onProgress?.(`  ↳ Cobalt status: ${data.status} ${data.error?.code ?? ""}`);
    } else {
      onProgress?.(`  ↳ Cobalt HTTP ${res.status}`);
    }
  } catch (e: any) {
    onProgress?.(`  ↳ Cobalt error: ${e.message}`);
  }

  throw new Error("All mirror instances failed — could not get audio stream URL");
}

async function transcribeViaAssemblyAI(
  videoId: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  // Get direct audio URL from Invidious/Piped (no download on Railway)
  onProgress?.("🔗 Getting audio stream URL from mirrors...");
  const audioUrl = await getAudioUrlFromInvidious(videoId, onProgress);

  // Submit transcription job with the direct URL
  onProgress?.("🎙️ Transcribing with AssemblyAI (Korean)...");
  const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: process.env.ASSEMBLYAI_API_KEY!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ audio_url: audioUrl, language_code: "ko" }),
  });
  if (!transcriptRes.ok) throw new Error(`AssemblyAI submit failed: ${transcriptRes.status}`);
  const { id } = await transcriptRes.json() as any;

  // Poll for completion
  while (true) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY! },
    });
    const data = await pollRes.json() as any;
    if (data.status === "completed") return data.text;
    if (data.status === "error") throw new Error(`AssemblyAI error: ${data.error}`);
    onProgress?.(`🎙️ Transcribing... (${data.status})`);
  }
}

function parseVtt(vtt: string): string {
  const lines = vtt.split("\n");
  const texts: string[] = [];
  let capturing = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (
      line.startsWith("WEBVTT") ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:") ||
      line === ""
    ) {
      capturing = false;
      continue;
    }

    if (line.includes("-->")) {
      capturing = true;
      continue;
    }

    if (capturing && line) {
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

  const deduped = texts.filter((t, i) => i === 0 || t !== texts[i - 1]);
  return deduped.join(" ").replace(/\s+/g, " ").trim();
}
