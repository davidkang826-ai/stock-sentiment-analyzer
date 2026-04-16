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

export async function getTranscript(videoId: string): Promise<string> {
  // Try youtube-transcript package with several language fallbacks
  const { YoutubeTranscript } = await import("youtube-transcript");

  // Try Korean first, then auto-generated, then any available
  const langAttempts = [{ lang: "ko" }, { lang: "ko-KR" }, {}];
  for (const opts of langAttempts) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId, opts as any);
      if (segments?.length) {
        return segments
          .map((s: any) => s.text)
          .join(" ")
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, " ")
          .trim();
      }
    } catch {
      // try next
    }
  }
  throw new Error("No transcript available for this video");
}
