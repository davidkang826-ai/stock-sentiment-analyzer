import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface TickerAnalysis {
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

export interface VideoAnalysis {
  videoSummary: string;
  tickers: TickerAnalysis[];
}

export async function analyzeTranscript(
  transcript: string,
  videoTitle: string
): Promise<VideoAnalysis> {
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are analyzing a Korean YouTube video transcript about stock market investing.

Video title: ${videoTitle}

INSTRUCTIONS:
1. Read the Korean transcript carefully
2. Identify every US stock (NYSE or NASDAQ listed) mentioned — by company name in Korean (e.g. 엔비디아=NVDA, 애플=AAPL, 테슬라=TSLA, 마이크로소프트=MSFT) OR by ticker symbol
3. IGNORE all non-US stocks (Korean stocks like 삼성, Chinese stocks, etc.)
4. For each US stock, determine the creator's sentiment based on what they said
5. Provide 2-4 key points in English summarizing what the creator said about each stock
6. Return ONLY valid JSON — no markdown, no explanation, no code fences

JSON structure to return:
{
  "videoSummary": "2-3 sentence English summary of the video's main topic",
  "tickers": [
    {
      "ticker": "NVDA",
      "companyName": "NVIDIA",
      "sentiment": "bullish",
      "sentimentScore": 0.8,
      "keyPoints": ["Creator expects strong AI chip demand", "Bullish on data center growth"],
      "mentionCount": 7
    }
  ]
}

sentiment: "bullish" | "bearish" | "neutral"
sentimentScore: -1.0 (very bearish) to 1.0 (very bullish), 0.0 = neutral

If no US stocks are mentioned, return: { "videoSummary": "...", "tickers": [] }

Transcript (Korean):
${transcript.slice(0, 14000)}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  try {
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(clean) as VideoAnalysis;
    // Normalize
    parsed.tickers = (parsed.tickers ?? []).map((t) => ({
      ...t,
      sentiment: (["bullish", "bearish", "neutral"].includes(t.sentiment)
        ? t.sentiment
        : "neutral") as "bullish" | "bearish" | "neutral",
      sentimentScore: Math.max(-1, Math.min(1, t.sentimentScore ?? 0)),
    }));
    return parsed;
  } catch {
    return { videoSummary: "Could not parse analysis.", tickers: [] };
  }
}
