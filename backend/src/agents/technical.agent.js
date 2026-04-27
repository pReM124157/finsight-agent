import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export async function technicalAgent(symbol) {
  try {
    const period2 = new Date();
    const period1 = new Date();
    period1.setDate(period2.getDate() - 100); // Fetch 100 days to be safe

    const queryOptions = {
      period1: period1.toISOString().split('T')[0],
      interval: '1d'
    };

    console.log(`Fetching historical data for ${symbol}...`);
    const history = await yahooFinance.historical(symbol, queryOptions);
    
    if (!history || !history.length || history.length < 20) {
      console.warn(`Insufficient history for ${symbol}`);
      return { 
        score: 5, 
        rsi: 50, 
        trend: "NEUTRAL", 
        message: "Insufficient data",
        currentPrice: 0 
      };
    }

    const currentPrice = history[history.length - 1]?.close || 0;

    const prices = history.map(h => h.close).filter(p => p != null);
    const latestPrice = prices[prices.length - 1];
    
    // Simple Moving Averages
    const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = prices.length >= 50 
      ? prices.slice(-50).reduce((a, b) => a + b, 0) / 50 
      : sma20;

    // RSI Calculation (14 periods)
    let gains = 0;
    let losses = 0;
    for (let i = prices.length - 14; i < prices.length; i++) {
      const diff = prices[i] - prices[i-1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rs = avgGain / (avgLoss || 1);
    const rsi = 100 - (100 / (1 + rs));

    // Momentum Scoring (1-10)
    let score = 5;
    
    // Price vs MAs
    if (latestPrice > sma20) score += 1;
    if (latestPrice > sma50) score += 1;
    
    // RSI scoring
    if (rsi < 30) score += 2; // Oversold - potential bounce
    else if (rsi > 70) score -= 2; // Overbought - potential pullback
    else if (rsi >= 40 && rsi <= 60) score += 1; // Stable uptrend
    
    // Trend strength
    if (sma20 > sma50) score += 1; // Golden cross or bullish alignment

    score = Math.min(Math.max(score, 1), 10);

    return {
      score,
      rsi: Math.round(rsi),
      sma20: Number(sma20.toFixed(2)),
      sma50: Number(sma50.toFixed(2)),
      currentPrice,
      trend: latestPrice > sma20 ? "BULLISH" : "BEARISH",
      momentumStrength: score >= 8 ? "STRONG" : score >= 6 ? "MODERATE" : "WEAK"
    };
  } catch (error) {
    console.error("Technical Agent Error:", error.message);
    return { 
      score: 5, 
      rsi: 50, 
      trend: "UNKNOWN", 
      message: error.message 
    };
  }
}
