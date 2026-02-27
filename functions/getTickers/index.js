import functions from "@google-cloud/functions-framework";
import YahooFinance from "yahoo-finance2";
import axios from "axios";

// yahoo-finance2 v3: must instantiate the class
const yf = new YahooFinance();

const BACKEND_URL =
  process.env.PORTFOLIO_TRACKER_BACKEND_URL || "http://localhost:3001";
const MF_API_URL = "https://api.mfapi.in/mf/latest";

/**
 * Fetch live prices for stock tickers using yahoo-finance2 v3 (batch quote).
 * Returns a Map: tickerName -> regularMarketPrice
 */
async function fetchStockPrices(stocks) {
  if (!stocks?.length) return new Map();

  const symbols = stocks.map((s) =>
    s.currency === "INR" ? `${s.tickerName}.NS` : s.tickerName,
  );

  try {
    const results = await yf.quote(symbols, {
      fields: ["symbol", "regularMarketPrice", "currency"],
    });

    const priceMap = new Map();

    const resultsArr = Array.isArray(results) ? results : [results];

    for (const result of resultsArr) {
      if (!result?.symbol) continue;

      // Handle cases where regularMarketPrice might be missing
      const price =
        result.regularMarketPrice ??
        result.price ??
        result.regularMarketDayHigh ??
        null;

      priceMap.set(result.symbol.replace(".NS", ""), price);
    }

    return priceMap;
  } catch (err) {
    console.error("Yahoo fetch failed:", err?.message);
    return new Map();
  }
}

/**
 * Fetch all latest NAVs from mfapi.in.
 * Returns a Map: isinGrowth -> nav (number)
 */
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

/**
 * HTTP Cloud Function to get all tickers from Portfolio-Tracker-Backend,
 * enriched with live prices from Yahoo Finance (stocks) and mfapi.in (MFs).
 *
 * Response:
 * {
 *   "message": "...",
 *   "data": [
 *     { ...tickerFields, "price": <number | null> }
 *   ]
 * }
 */
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
    // 1. Fetch all tickers from backend
    const backendResponse = await fetch(`${BACKEND_URL}/api/v1/tickers`);
    const backendData = await backendResponse.json();

    if (!backendResponse.ok || !Array.isArray(backendData.data)) {
      return res.status(backendResponse.status).json(backendData);
    }

    const tickers = backendData.data;

    // 2. Split by type
    const stocks = tickers.filter((t) => t.type === "Stock");
    const mfs = tickers.filter((t) => t.type === "MF");

    // 3. Fetch stock prices & MF NAVs in parallel
    const [stockPriceMap, mfIsinMap] = await Promise.all([
      fetchStockPrices(stocks),
      mfs.length > 0 ? fetchMFPrices() : Promise.resolve(new Map()),
    ]);

    // 4. Enrich tickers with prices
    const enrichedData = tickers.map((ticker) => {
      let price = null;

      if (ticker.type === "Stock") {
        price = stockPriceMap.get(ticker.tickerName) ?? null;
      } else if (ticker.type === "MF") {
        // tickerName is the ISIN — match against isinGrowth from mfapi
        price = mfIsinMap.get(ticker.tickerName) ?? null;
      }

      return { ...ticker, price };
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
