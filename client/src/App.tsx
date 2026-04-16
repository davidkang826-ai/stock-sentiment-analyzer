import { useCallback, useRef, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Youtube,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ChannelInfo {
  channelId: string;
  channelTitle: string;
  thumbnail: string;
}

interface TickerResult {
  ticker: string;
  companyName: string;
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number;
  keyPoints: string[];
  mentionCount: number;
  priceOnVideoDate?: number | null;
  currentPrice?: number | null;
  priceChangePct?: number | null;
}

interface VideoResult {
  video: {
    id: string;
    title: string;
    publishedAt: string;
    thumbnail: string;
  };
  analysis: {
    videoSummary: string;
    tickers: TickerResult[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([^&]+)/) ??
    url.match(/youtu\.be\/([^?]+)/) ??
    url.match(/embed\/([^?]+)/);
  return m ? m[1] : null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPrice(p: number | null | undefined) {
  if (p == null) return "—";
  return `$${p.toFixed(2)}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SentimentBadge({ sentiment, score }: { sentiment: string; score: number }) {
  const cfg = {
    bullish: {
      bg: "bg-emerald-100 text-emerald-800",
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      label: "Bullish",
    },
    bearish: {
      bg: "bg-red-100 text-red-800",
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      label: "Bearish",
    },
    neutral: {
      bg: "bg-gray-100 text-gray-700",
      icon: <Minus className="h-3.5 w-3.5" />,
      label: "Neutral",
    },
  }[sentiment] ?? { bg: "bg-gray-100 text-gray-700", icon: null, label: sentiment };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg}`}>
      {cfg.icon}
      {cfg.label}
      <span className="opacity-60">({score >= 0 ? "+" : ""}{score.toFixed(2)})</span>
    </span>
  );
}

function PriceChange({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-gray-400 text-sm">—</span>;
  const pos = pct >= 0;
  return (
    <span className={`text-sm font-medium flex items-center gap-0.5 ${pos ? "text-emerald-600" : "text-red-600"}`}>
      {pos ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {pos ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function VideoCard({ result }: { result: VideoResult }) {
  const [expanded, setExpanded] = useState(true);
  const { video, analysis } = result;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Video header */}
      <div className="flex gap-4 p-4 border-b border-gray-50">
        <a
          href={`https://www.youtube.com/watch?v=${video.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-32 h-20 object-cover rounded-lg"
          />
        </a>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <a
              href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-gray-900 hover:text-indigo-600 transition-colors line-clamp-2 text-sm leading-snug"
            >
              {video.title}
            </a>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="shrink-0 p-1 rounded hover:bg-gray-100 text-gray-400"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">{formatDate(video.publishedAt)}</p>
          {analysis.videoSummary && (
            <p className="text-xs text-gray-600 mt-2 line-clamp-2">{analysis.videoSummary}</p>
          )}
        </div>
      </div>

      {/* Tickers table */}
      {expanded && (
        <div className="p-4">
          {analysis.tickers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No US stocks identified in this video.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <th className="pb-2 pr-4 font-medium">Ticker</th>
                    <th className="pb-2 pr-4 font-medium">Sentiment</th>
                    <th className="pb-2 pr-4 font-medium">Key Points</th>
                    <th className="pb-2 pr-4 font-medium text-right">Price (Video Date)</th>
                    <th className="pb-2 pr-4 font-medium text-right">Current Price</th>
                    <th className="pb-2 font-medium text-right">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {analysis.tickers.map((t) => (
                    <tr key={t.ticker} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 pr-4">
                        <a
                          href={`https://finance.yahoo.com/quote/${t.ticker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 group"
                        >
                          <span className="font-bold text-indigo-700 group-hover:text-indigo-900">
                            {t.ticker}
                          </span>
                          <ExternalLink className="h-3 w-3 text-gray-300 group-hover:text-indigo-400" />
                        </a>
                        <span className="text-xs text-gray-400">{t.companyName}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <SentimentBadge sentiment={t.sentiment} score={t.sentimentScore} />
                        <div className="text-xs text-gray-400 mt-0.5">{t.mentionCount}× mentioned</div>
                      </td>
                      <td className="py-3 pr-4 max-w-xs">
                        <ul className="space-y-0.5">
                          {t.keyPoints.map((kp, i) => (
                            <li key={i} className="text-xs text-gray-600 flex gap-1">
                              <span className="text-gray-300 shrink-0">•</span>
                              <span>{kp}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-gray-700 text-xs">
                        {formatPrice(t.priceOnVideoDate)}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-gray-700 text-xs">
                        {formatPrice(t.currentPrice)}
                      </td>
                      <td className="py-3 text-right">
                        <PriceChange pct={t.priceChangePct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [videoUrl, setVideoUrl] = useState(
    "https://www.youtube.com/watch?v=l1IFamaX_bg"
  );
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [isLoadingChannel, setIsLoadingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(daysAgoStr(3));
  const [endDate, setEndDate] = useState(todayStr());

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [results, setResults] = useState<VideoResult[]>([]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);

  const loadChannel = useCallback(async () => {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      setChannelError("Could not extract video ID from URL.");
      return;
    }
    setIsLoadingChannel(true);
    setChannelError(null);
    setChannelInfo(null);
    setResults([]);
    setIsDone(false);
    try {
      const res = await fetch(`/api/channel-info?videoId=${videoId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChannelInfo(data);
    } catch (e: any) {
      setChannelError(e.message);
    } finally {
      setIsLoadingChannel(false);
    }
  }, [videoUrl]);

  const analyze = useCallback(async () => {
    if (!channelInfo) return;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setProgressLog([]);
    setResults([]);
    setIsDone(false);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: channelInfo.channelId,
          startDate,
          endDate,
        }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as any;
            if (event.type === "progress") {
              setProgressLog((prev) => [...prev, event.message]);
              setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
            } else if (event.type === "video_done") {
              setResults((prev) => [...prev, { video: event.video, analysis: event.analysis }]);
            } else if (event.type === "error") {
              setAnalyzeError(event.message);
            } else if (event.type === "done") {
              setIsDone(true);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setAnalyzeError(e.message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [channelInfo, startDate, endDate]);

  const totalTickers = results.reduce((n, r) => n + r.analysis.tickers.length, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-700 to-indigo-900 text-white">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <Youtube className="h-8 w-8 text-red-400" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Stock Sentiment Analyzer</h1>
              <p className="text-indigo-300 text-sm">Analyze Korean YouTube stock commentary — US tickers only</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Setup card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          {/* Video URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              YouTube Video URL
              <span className="text-gray-400 font-normal ml-1">(any video from the channel)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                onClick={loadChannel}
                disabled={isLoadingChannel || !videoUrl.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoadingChannel ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Load Channel
              </button>
            </div>
            {channelError && (
              <p className="text-red-500 text-xs mt-1.5">{channelError}</p>
            )}
          </div>

          {/* Channel info */}
          {channelInfo && (
            <div className="flex items-center gap-3 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              {channelInfo.thumbnail && (
                <img
                  src={channelInfo.thumbnail}
                  alt={channelInfo.channelTitle}
                  className="w-10 h-10 rounded-full"
                />
              )}
              <div>
                <p className="text-sm font-medium text-indigo-900">{channelInfo.channelTitle}</p>
                <p className="text-xs text-indigo-500">Channel loaded</p>
              </div>
            </div>
          )}

          {/* Date range */}
          {channelInfo && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={todayStr()}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Quick presets */}
          {channelInfo && (
            <div className="flex gap-2">
              {[
                { label: "Last 3 days", start: daysAgoStr(3) },
                { label: "Last 7 days", start: daysAgoStr(7) },
                { label: "Last 14 days", start: daysAgoStr(14) },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setStartDate(p.start); setEndDate(todayStr()); }}
                  className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded-full hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Analyze button */}
          {channelInfo && (
            <button
              onClick={analyze}
              disabled={isAnalyzing}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <TrendingUp className="h-4 w-4" />
                  Analyze Videos
                </>
              )}
            </button>
          )}
        </div>

        {/* Progress log */}
        {progressLog.length > 0 && (
          <div className="bg-gray-900 rounded-2xl p-4">
            <p className="text-xs text-gray-500 font-mono mb-2 uppercase tracking-wide">Progress</p>
            <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-xs">
              {progressLog.map((msg, i) => (
                <div key={i} className="text-emerald-400">{msg}</div>
              ))}
              {isAnalyzing && (
                <div className="text-gray-500 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Processing...
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Error */}
        {analyzeError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            Error: {analyzeError}
          </div>
        )}

        {/* Summary */}
        {isDone && results.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-indigo-900">
                Analysis Complete
              </p>
              <p className="text-xs text-indigo-600 mt-0.5">
                {results.length} video(s) analyzed · {totalTickers} US ticker(s) identified
              </p>
            </div>
            <div className="flex gap-4 text-center">
              <div>
                <p className="text-xl font-bold text-emerald-600">
                  {results.flatMap(r => r.analysis.tickers).filter(t => t.sentiment === "bullish").length}
                </p>
                <p className="text-xs text-gray-500">Bullish</p>
              </div>
              <div>
                <p className="text-xl font-bold text-red-500">
                  {results.flatMap(r => r.analysis.tickers).filter(t => t.sentiment === "bearish").length}
                </p>
                <p className="text-xs text-gray-500">Bearish</p>
              </div>
              <div>
                <p className="text-xl font-bold text-gray-400">
                  {results.flatMap(r => r.analysis.tickers).filter(t => t.sentiment === "neutral").length}
                </p>
                <p className="text-xs text-gray-500">Neutral</p>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            {results.map((r) => (
              <VideoCard key={r.video.id} result={r} />
            ))}
          </div>
        )}

        {isDone && results.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No videos with transcripts found in the selected date range.
          </div>
        )}
      </div>
    </div>
  );
}
