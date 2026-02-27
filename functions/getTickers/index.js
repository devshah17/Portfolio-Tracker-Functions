import functions from "@google-cloud/functions-framework";
import express from "express";

const app = express();
app.use(express.json());

const BACKEND_URL =
  process.env.PORTFOLIO_TRACKER_BACKEND_URL || "http://localhost:3001";

const handler = async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight request
  if (req.method === "OPTIONS") {
    res.status(204).send("");
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
};

// Respond to both root and /getTickers paths
app.get("/", handler);
app.get("/getTickers", handler);
app.options("*", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.status(204).send("");
});

/**
 * HTTP Cloud Function to get all tickers from Portfolio-Tracker-Backend
 * Accepts GET requests and proxies to the backend /api/v1/tickers endpoint
 *
 * Response:
 * {
 *   "message": "...",
 *   "data": [...] // Array of ticker objects
 * }
 */
functions.http("getTickers", app);
