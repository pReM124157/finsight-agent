/**
 * Hermes Intent Router for Finsight
 * Purpose:
 * - Classify user message
 * - Extract stock symbol / action / timeframe / alert condition
 * - Return strict JSON only
 *
 * Safety:
 * - Does NOT fetch prices
 * - Does NOT make trade decisions
 * - Does NOT bypass market validation
 * - Falls back to deterministic regex if Hermes is disabled/unavailable
 */

const INTENTS = {
  STOCK_ANALYSIS: "STOCK_ANALYSIS",
  TRADE_DECISION: "TRADE_DECISION",
  PRICE_CHECK: "PRICE_CHECK",
  PORTFOLIO_REVIEW: "PORTFOLIO_REVIEW",
  ALERT_CREATE: "ALERT_CREATE",
  NEWS_EXPLAIN: "NEWS_EXPLAIN",
  MARKET_OVERVIEW: "MARKET_OVERVIEW",
  COMPARE_STOCKS: "COMPARE_STOCKS",
  POSITION_EXIT: "POSITION_EXIT",
  RISK_EXPLAIN: "RISK_EXPLAIN",
  EDUCATIONAL_QUERY: "EDUCATIONAL_QUERY",
  CASUAL_CHAT: "CASUAL_CHAT",
  UNKNOWN: "UNKNOWN"
};

function safeJsonParse(text) {
  try {
    const cleaned = String(text || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first === -1 || last === -1) return null;

    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

function normalizeSymbol(raw) {
  if (!raw) return null;

  const value = String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();

  const aliases = {
    HDFC: "HDFCBANK",
    HDFCBANK: "HDFCBANK",
    HDFCBANKLTD: "HDFCBANK",
    HDFCBANKLIMITED: "HDFCBANK",
    ICICI: "ICICIBANK",
    ICICIBANK: "ICICIBANK",
    AXIS: "AXISBANK",
    AXISBANK: "AXISBANK",
    RELIANCE: "RELIANCE",
    RIL: "RELIANCE",
    TCS: "TCS",
    INFY: "INFY",
    INFOSYS: "INFY",
    SBIN: "SBIN",
    SBI: "SBIN",
    KOTAK: "KOTAKBANK",
    KOTAKBANK: "KOTAKBANK",
    WIPRO: "WIPRO"
  };

  return aliases[value] || value || null;
}

function extractLikelySymbols(message) {
  const text = String(message || "").toUpperCase();

  const known = [
    "RELIANCE",
    "RIL",
    "TCS",
    "INFY",
    "INFOSYS",
    "HDFCBANK",
    "HDFC",
    "ICICIBANK",
    "ICICI",
    "AXISBANK",
    "AXIS",
    "SBIN",
    "SBI",
    "KOTAKBANK",
    "KOTAK",
    "WIPRO"
  ];

  const found = [];

  for (const symbol of known) {
    const pattern = new RegExp(`\\b${symbol}\\b`, "i");
    if (pattern.test(text)) {
      const normalized = normalizeSymbol(symbol);
      if (normalized && !found.includes(normalized)) found.push(normalized);
    }
  }

  return found;
}

function deterministicIntentFallback(message) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const symbols = extractLikelySymbols(text);
  const symbol = symbols[0] || null;

  if (/^(hi|hello|hey|yo|sup)\b/i.test(lower)) {
    return {
      intent: INTENTS.CASUAL_CHAT,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/portfolio|holdings|my stocks|my positions/i.test(lower)) {
    return {
      intent: INTENTS.PORTFOLIO_REVIEW,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/alert|notify|remind/i.test(lower)) {
    const priceMatch = lower.match(/(?:above|below|crosses|cross|at|near)\s*₹?\s*(\d+(?:\.\d+)?)/i);
    const condition = /below|under|less/i.test(lower) ? "below" : "above";

    return {
      intent: INTENTS.ALERT_CREATE,
      symbol,
      symbols,
      exchange: "NSE",
      condition,
      price: priceMatch ? Number(priceMatch[1]) : null,
      confidence: symbol ? 0.9 : 0.6,
      source: "deterministic"
    };
  }

  if (/vs|compare|better between|which is better/i.test(lower) && symbols.length >= 2) {
    return {
      intent: INTENTS.COMPARE_STOCKS,
      symbol: null,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/price|trading at|current price|ltp/i.test(lower)) {
    return {
      intent: INTENTS.PRICE_CHECK,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      confidence: symbol ? 0.9 : 0.55,
      source: "deterministic"
    };
  }

  if (/why.*(fall|fell|down|up|rise|rally)|news|reason/i.test(lower)) {
    return {
      intent: INTENTS.NEWS_EXPLAIN,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsNews: true,
      confidence: symbol ? 0.85 : 0.6,
      source: "deterministic"
    };
  }

  if (/exit|sell|stop loss|stoploss|book profit|trim/i.test(lower)) {
    return {
      intent: INTENTS.POSITION_EXIT,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsTechnical: true,
      confidence: symbol ? 0.9 : 0.6,
      source: "deterministic"
    };
  }

  if (/risk|danger|safe|unsafe/i.test(lower)) {
    return {
      intent: INTENTS.RISK_EXPLAIN,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      confidence: symbol ? 0.85 : 0.6,
      source: "deterministic"
    };
  }

  if (/buy|enter|entry|invest|should i|deploy/i.test(lower) && symbol) {
    return {
      intent: INTENTS.TRADE_DECISION,
      symbol,
      symbols,
      exchange: "NSE",
      actionRequested: /sell|exit/i.test(lower) ? "SELL" : "BUY",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/analyze|analysis|view|opinion|breakdown/i.test(lower) && symbol) {
    return {
      intent: INTENTS.STOCK_ANALYSIS,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      needsNews: false,
      confidence: 0.9,
      source: "deterministic"
    };
  }

  if (/nifty|sensex|market|index/i.test(lower)) {
    return {
      intent: INTENTS.MARKET_OVERVIEW,
      symbol: null,
      symbols: [],
      exchange: "NSE",
      needsLivePrice: true,
      confidence: 0.85,
      source: "deterministic"
    };
  }

  if (/what is|explain|meaning of|how does/i.test(lower)) {
    return {
      intent: INTENTS.EDUCATIONAL_QUERY,
      symbol,
      symbols,
      exchange: "NSE",
      confidence: 0.8,
      source: "deterministic"
    };
  }

  if (symbol) {
    return {
      intent: INTENTS.STOCK_ANALYSIS,
      symbol,
      symbols,
      exchange: "NSE",
      needsLivePrice: true,
      needsFundamentals: true,
      needsTechnical: true,
      confidence: 0.75,
      source: "deterministic"
    };
  }

  return {
    intent: INTENTS.UNKNOWN,
    symbol: null,
    symbols: [],
    exchange: "NSE",
    confidence: 0.4,
    source: "deterministic"
  };
}

function buildHermesPrompt(message) {
  return `
You are Finsight's intent router.

Return ONLY valid JSON.
Do not explain.
Do not give financial advice.
Do not fetch prices.
Do not generate analysis.

Classify the user message into one of:
${Object.values(INTENTS).join(", ")}

Extract:
- intent
- symbol
- symbols
- exchange
- timeframe
- actionRequested
- condition
- price
- needsLivePrice
- needsFundamentals
- needsTechnical
- needsNews
- confidence

Rules:
- Use NSE as default exchange for Indian stocks.
- Normalize Reliance/RIL to RELIANCE.
- Normalize Infosys to INFY.
- Normalize HDFC Bank/HDFC to HDFCBANK.
- Normalize ICICI to ICICIBANK.
- Normalize Axis/Axis Bank to AXISBANK.
- If user asks buy/sell/entry, intent is TRADE_DECISION.
- If user asks full view/analysis, intent is STOCK_ANALYSIS.
- If user asks only price, intent is PRICE_CHECK.
- If user asks alert/notify, intent is ALERT_CREATE.
- If ambiguous, use UNKNOWN with low confidence.

User message:
"${message}"

JSON:
`.trim();
}

export async function classifyIntentWithHermes(message) {
  const fallback = deterministicIntentFallback(message);

  if (process.env.HERMES_ENABLED !== "true") {
    return fallback;
  }

  const baseUrl = process.env.HERMES_BASE_URL;
  const apiKey = process.env.HERMES_API_KEY;
  const model = process.env.HERMES_MODEL || "NousResearch/Hermes-3-Llama-3.1-8B";

  if (!baseUrl) {
    return {
      ...fallback,
      hermesError: "HERMES_BASE_URL missing"
    };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: "You are a strict JSON intent classifier for a financial assistant."
          },
          {
            role: "user",
            content: buildHermesPrompt(message)
          }
        ]
      })
    });

    if (!response.ok) {
      return {
        ...fallback,
        hermesError: `Hermes HTTP ${response.status}`
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(content);

    if (!parsed || !parsed.intent) {
      return {
        ...fallback,
        hermesError: "Hermes returned invalid JSON"
      };
    }

    const normalized = {
      intent: parsed.intent || fallback.intent,
      symbol: normalizeSymbol(parsed.symbol) || fallback.symbol,
      symbols: Array.isArray(parsed.symbols)
        ? parsed.symbols.map(normalizeSymbol).filter(Boolean)
        : fallback.symbols || [],
      exchange: parsed.exchange || "NSE",
      timeframe: parsed.timeframe || null,
      actionRequested: parsed.actionRequested || null,
      condition: parsed.condition || null,
      price: parsed.price !== undefined && parsed.price !== null ? Number(parsed.price) : null,
      needsLivePrice: Boolean(parsed.needsLivePrice),
      needsFundamentals: Boolean(parsed.needsFundamentals),
      needsTechnical: Boolean(parsed.needsTechnical),
      needsNews: Boolean(parsed.needsNews),
      confidence: Number(parsed.confidence || fallback.confidence || 0.5),
      source: "hermes"
    };

    if (!normalized.symbol && normalized.symbols.length === 1) {
      normalized.symbol = normalized.symbols[0];
    }

    return normalized;
  } catch (error) {
    return {
      ...fallback,
      hermesError: error?.message || String(error)
    };
  }
}

export { INTENTS, deterministicIntentFallback };
