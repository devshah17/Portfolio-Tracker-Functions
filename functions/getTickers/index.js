import functions from "@google-cloud/functions-framework";
import YahooFinance from "yahoo-finance2";
import axios from "axios";

// yahoo-finance2 v3: must instantiate the class
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const BACKEND_URL =
  process.env.PORTFOLIO_TRACKER_BACKEND_URL || "http://localhost:3001";
const MF_API_URL = "https://api.mfapi.in/mf/latest";

/**
 * Fetch live prices for stock tickers using yahoo-finance2 v3 (batch quote).
 * Returns a Map: tickerName -> regularMarketPrice
 */
async function fetchStockPrices(stocks) {
  if (!stocks?.length) return new Map();

  const symbols = stocks.map((s) => s.tickerName);
  console.log("symbols", symbols);

  try {
    const BATCH_SIZE = 25;
    const batches = [];
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      batches.push(symbols.slice(i, i + BATCH_SIZE));
    }

    const batchPromises = batches.map((batch) =>
      yf.quote(batch).catch((err) => {
        console.error(`Error fetching batch ${batch}:`, err?.message || err);
        return [];
      }),
    );

    const results = await Promise.all(batchPromises);

    const resultsArr = results.flat().filter(Boolean);

    const priceMap = new Map();

    for (const result of resultsArr) {
      if (!result?.symbol) continue;

      const price =
        result.regularMarketPrice ??
        result.price ??
        result.regularMarketDayHigh ??
        null;

      const priceMapObj = {
        price,
        regularMarketPrice: price,
        trailingPE: result.trailingPE ?? null,
        forwardPE: result.forwardPE ?? null,
        epsTrailingTwelveMonths: result.epsTrailingTwelveMonths ?? null,
        epsForward: result.epsForward ?? null,
        priceToBook: result.priceToBook ?? null,
        marketCap: result.marketCap ?? null,
        dividendYield: result.dividendYield ?? null,
        trailingAnnualDividendYield: result.trailingAnnualDividendYield ?? null,
        fiftyDayAverage: result.fiftyDayAverage ?? null,
        twoHundredDayAverage: result.twoHundredDayAverage ?? null,
        fiftyTwoWeekHigh: result.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: result.fiftyTwoWeekLow ?? null,
        regularMarketVolume: result.regularMarketVolume ?? null,
        averageDailyVolume3Month: result.averageDailyVolume3Month ?? null,
        averageAnalystRating: result.averageAnalystRating ?? null,
      };

      priceMap.set(result.symbol, priceMapObj);
      priceMap.set(result.symbol.replace(".NS", ""), priceMapObj);
    }

    return priceMap;
  } catch (err) {
    console.error("Yahoo fetch failed:", err?.message);
    return new Map();
  }
}

async function fetchMFPrices() {
  try {
    const { data: mfList } = await axios.get(MF_API_URL, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!Array.isArray(mfList)) {
      throw new Error("Unexpected response from mfapi.in");
    }

    const isinMap = new Map();
    for (const scheme of mfList) {
      if (scheme.isinGrowth && scheme.nav) {
        isinMap.set(scheme.isinGrowth, parseFloat(scheme.nav));
      }
    }
    return isinMap;
  } catch (err) {
    console.error("Error fetching MF data from mfapi.in:", err.message);
    return new Map();
  }
}

functions.http("getTickers", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const backendResponse = await fetch(`${BACKEND_URL}/api/v1/tickers`);
    const backendData = await backendResponse.json();

    if (!backendResponse.ok || !Array.isArray(backendData.data)) {
      return res.status(backendResponse.status).json(backendData);
    }

    const tickers = backendData.data;

    const stocks = tickers.filter((t) => t.type === "Stock");
    const mfs = tickers.filter((t) => t.type === "MF");

    const [stockPriceMap, mfIsinMap] = await Promise.all([
      fetchStockPrices(stocks),
      mfs.length > 0 ? fetchMFPrices() : Promise.resolve(new Map()),
    ]);

    const enrichedData = tickers.map((ticker) => {
      if (ticker.type === "Stock") {
        const stockInfo =
          stockPriceMap.get(ticker.tickerName) ||
          stockPriceMap.get(ticker.tickerName.replace(".NS", "")) ||
          stockPriceMap.get(`${ticker.tickerName}.NS`) ||
          null;

        return {
          ...ticker,
          price: stockInfo?.price ?? null,
          regularMarketPrice: stockInfo?.regularMarketPrice ?? null,
          trailingPE: stockInfo?.trailingPE ?? null,
          forwardPE: stockInfo?.forwardPE ?? null,
          epsTrailingTwelveMonths: stockInfo?.epsTrailingTwelveMonths ?? null,
          epsForward: stockInfo?.epsForward ?? null,
          priceToBook: stockInfo?.priceToBook ?? null,
          marketCap: stockInfo?.marketCap ?? null,
          dividendYield: stockInfo?.dividendYield ?? null,
          trailingAnnualDividendYield:
            stockInfo?.trailingAnnualDividendYield ?? null,
          fiftyDayAverage: stockInfo?.fiftyDayAverage ?? null,
          twoHundredDayAverage: stockInfo?.twoHundredDayAverage ?? null,
          fiftyTwoWeekHigh: stockInfo?.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow: stockInfo?.fiftyTwoWeekLow ?? null,
          regularMarketVolume: stockInfo?.regularMarketVolume ?? null,
          averageDailyVolume3Month: stockInfo?.averageDailyVolume3Month ?? null,
          averageAnalystRating: stockInfo?.averageAnalystRating ?? null,
        };
      } else if (ticker.type === "MF") {
        const price = mfIsinMap.get(ticker.tickerName) ?? null;
        return {
          ...ticker,
          price,
          regularMarketPrice: price,
          trailingPE: null,
          forwardPE: null,
          epsTrailingTwelveMonths: null,
          epsForward: null,
          priceToBook: null,
          marketCap: null,
          dividendYield: null,
          trailingAnnualDividendYield: null,
          fiftyDayAverage: null,
          twoHundredDayAverage: null,
          fiftyTwoWeekHigh: null,
          fiftyTwoWeekLow: null,
          regularMarketVolume: null,
          averageDailyVolume3Month: null,
          averageAnalystRating: null,
        };
      }

      return ticker;
    });

    res.status(200).json({
      message: backendData.message || "Tickers fetched successfully",
      data: enrichedData,
    });
  } catch (error) {
    console.error("Error in getTickers function:", error);
    res.status(500).json({
      error: "Failed to fetch tickers",
      message: error.message,
    });
  }
});
