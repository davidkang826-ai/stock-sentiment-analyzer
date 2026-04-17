import yahooFinance from "yahoo-finance2";

export interface PriceData {
  historical: number | null;
  current: number | null;
}

export async function getStockPrices(
  tickers: string[],
  videoDate: string
): Promise<Map<string, PriceData>> {
  const result = new Map<string, PriceData>();

  // Fetch a 5-day window around the video date to handle weekends/holidays
  const dateObj = new Date(videoDate);
  const windowStart = new Date(dateObj);
  windowStart.setDate(windowStart.getDate() - 3);
  const windowEnd = new Date(dateObj);
  windowEnd.setDate(windowEnd.getDate() + 3);

  await Promise.allSettled(
    tickers.map(async (ticker) => {
      try {
        const [historical, quote] = await Promise.allSettled([
          yahooFinance.historical(ticker, {
            period1: windowStart.toISOString().slice(0, 10),
            period2: windowEnd.toISOString().slice(0, 10),
          }),
          yahooFinance.quote(ticker),
        ]);

        // Find the closest trading day on or before the video date
        let histPrice: number | null = null;
        if (historical.status === "fulfilled" && historical.value.length > 0) {
          const targetTs = dateObj.getTime();
          // Sort ascending by date
          const sorted = historical.value.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
          );
          // Find last bar on or before video date
          const bar = sorted
            .filter((b) => new Date(b.date).getTime() <= targetTs + 24 * 3600 * 1000)
            .at(-1);
          histPrice = bar?.close ?? null;
        }

        const currentPrice =
          quote.status === "fulfilled"
            ? (quote.value.regularMarketPrice ?? null)
            : null;

        result.set(ticker, { historical: histPrice, current: currentPrice });
      } catch {
        result.set(ticker, { historical: null, current: null });
      }
    })
  );

  return result;
}
