import functions from "@google-cloud/functions-framework";

const BACKEND_URL =
  process.env.PORTFOLIO_TRACKER_BACKEND_URL || "http://localhost:3001";

/**
 * HTTP Cloud Function to get all tickers from Portfolio-Tracker-Backend
 * Accepts POST requests and proxies to the backend /api/v1/tickers endpoint.
 *
 * Response:
 * {
 *   "message": "...",
 *   "data": [...] // Array of ticker objects
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
    const response = await fetch(`${BACKEND_URL}/api/v1/tickers`);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error("Error in getTickers function:", error);
    res.status(500).json({
      error: "Failed to fetch tickers",
      message: error.message,
    });
  }
});
