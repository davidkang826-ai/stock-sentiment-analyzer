import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { getChannelInfoFromVideo, getChannelVideos, getTranscript } from "./youtube.js";
import { analyzeTranscript } from "./analysis.js";
import { getStockPrices } from "./prices.js";

const app = express();
app.use(cors());
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── GET /api/channel-info?videoId=... ────────────────────────────────────────
app.get("/api/channel-info", async (req, res) => {
  const { videoId } = req.query;
  if (!videoId || typeof videoId !== "string") {
    res.status(400).json({ error: "videoId required" });
    return;
  }
  try {
    const info = await getChannelInfoFromVideo(videoId);
    res.json(info);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/analyze — SSE stream ───────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  const { channelId, startDate, endDate } = req.body as {
    channelId: string;
    startDate: string;
    endDate: string;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    emit({ type: "progress", message: "Fetching video list from channel..." });
    const videos = await getChannelVideos(channelId, startDate, endDate);

    if (videos.length === 0) {
      emit({ type: "progress", message: "No videos found in the selected date range." });
      emit({ type: "done", results: [] });
      res.end();
      return;
    }

    emit({ type: "progress", message: `Found ${videos.length} video(s). Starting analysis...` });

    const results: object[] = [];

    for (const video of videos) {
      emit({ type: "progress", message: `📹 Getting transcript: "${video.title}"` });

      let transcript = "";
      try {
        transcript = await getTranscript(video.id, (msg) => emit({ type: "progress", message: msg }));
      } catch (e: any) {
        emit({ type: "progress", message: `⚠️ Could not transcribe "${video.title}": ${e.message}` });
        continue;
      }

      emit({ type: "progress", message: `🤖 Analyzing sentiment with Claude...` });
      const analysis = await analyzeTranscript(transcript, video.title);

      if (analysis.tickers.length === 0) {
        emit({ type: "progress", message: `ℹ️ No US stocks found in "${video.title}"` });
      } else {
        emit({
          type: "progress",
          message: `📈 Found ${analysis.tickers.length} US ticker(s): ${analysis.tickers.map((t) => t.ticker).join(", ")}`,
        });

        // Fetch stock prices
        emit({ type: "progress", message: `💰 Fetching stock prices...` });
        const prices = await getStockPrices(
          analysis.tickers.map((t) => t.ticker),
          video.publishedAt
        );

        for (const ticker of analysis.tickers) {
          const p = prices.get(ticker.ticker);
          if (p) {
            ticker.priceOnVideoDate = p.historical;
            ticker.currentPrice = p.current;
            ticker.priceChangePct =
              p.historical && p.current
                ? ((p.current - p.historical) / p.historical) * 100
                : null;
          }
        }
      }

      const result = { video, analysis, transcript };
      results.push(result);
      emit({ type: "video_done", ...result });
    }

    emit({ type: "done", results });
    res.end();
  } catch (e: any) {
    emit({ type: "error", message: e.message });
    res.end();
  }
});

// ── Serve static client in production ─────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../dist")));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "../dist/index.html"));
  });
}

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
});
