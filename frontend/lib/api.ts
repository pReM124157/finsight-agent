import type {
  AnalysisResult,
  MarketOverview,
  PerformanceStats,
  SectorRotationItem,
  TopPick,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5005";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    cache: "no-store",
  });

  const text = await response.text();

  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `Request failed with ${response.status}`;

    throw new Error(message);
  }

  return payload as T;
}

export const api = {
  analyze: (symbol: string) =>
    request<AnalysisResult>("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ symbol }),
    }),

  downloadReport: async (symbol: string) => {
    const response = await fetch(
      `${BASE}/api/report/${encodeURIComponent(symbol.trim().toUpperCase())}`,
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      let message = `Request failed with ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.message && typeof payload.message === "string") {
          message = payload.message;
        }
      } catch {}
      throw new Error(message);
    }

    return response.blob();
  },

  scanner: {
    marketOverview: () =>
      request<MarketOverview>("/api/scanner/market-overview"),

    sectorRotation: () =>
      request<SectorRotationItem[]>("/api/scanner/sector-rotation"),

    topPicks: () =>
      request<TopPick[]>("/api/scanner/top-picks"),
  },

  analytics: {
    summary: () =>
      request<PerformanceStats>("/api/analytics/summary"),

    performance: () =>
      request<PerformanceStats>("/api/analytics/performance"),

    calibration: () =>
      request<unknown>("/api/analytics/calibration"),
  },
};

export { BASE as API_BASE_URL };
