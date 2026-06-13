export type ActionType = "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL" | string;

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY HIGH" | string;

export type OutcomeStatus = "TARGET_HIT" | "STOP_HIT" | "OPEN" | "EXPIRED" | string;

export interface AnalysisDecision {
  finalAction?: ActionType;
  finalDecision?: ActionType;
  confidenceScore?: number | null;
  finalConfidenceScore?: number | null;
  reasoning?: string;
}

export interface AnalysisResult {
  stock: string;
  symbol?: string;
  unavailable?: boolean;
  message?: string;
  currentPrice?: number;
  action?: ActionType;
  confidence?: number | null;
  conviction?: string;
  isLive?: boolean;
  isMarketOpen?: boolean;
  marketNote?: string | null;

  decision?: AnalysisDecision;

  risk?: {
    riskLevel?: RiskLevel;
    riskScore?: number | null;
    majorRisks?: string | object;
    [key: string]: unknown;
  };

  learning?: {
    confidenceBoost?: number;
    learningInsight?: string;
    [key: string]: unknown;
  };

  performance?: {
    performanceScore?: number;
    performanceInsight?: string;
    [key: string]: unknown;
  };

  rebalancing?: {
    rebalancingAdvice?: string;
    [key: string]: unknown;
  };

  analysis?: {
    stockFundamentals?: string;
    [key: string]: unknown;
  };

  valuation?: Record<string, unknown>;
  technical?: Record<string, unknown>;

  portfolio?: {
    healthScore?: number | null;
    dominantSector?: string;
    [key: string]: unknown;
  };

  entryTiming?: {
    strategy?: string;
    stopLoss?: string | number;
    initialTarget?: string | number;
    rewardRiskRatio?: string | number;
    finalExecutionAdvice?: string;
    [key: string]: unknown;
  };

  exitSignal?: {
    signal?: string;
    [key: string]: unknown;
  };

  capitalAction?: string;
  reason?: string;
  institutionalEvidence?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  news?: Record<string, unknown>;
}

export interface Recommendation {
  id?: string;
  recommendation_id?: string;
  symbol: string;
  action?: string;
  entry_price?: number | null;
  entryPrice?: number | null;
  target_price?: number | null;
  targetPrice?: number | null;
  stop_loss?: number | null;
  stop_price?: number | null;
  stopPrice?: number | null;
  outcome_status?: OutcomeStatus;
  status?: OutcomeStatus;
  realized_return_pct?: number | null;
  unrealized_return_pct?: number | null;
  return_pct?: number | null;
  max_upside_pct?: number | null;
  max_drawdown_pct?: number | null;
  recommendation_created_at?: string;
  created_at?: string;
  closed_at?: string | null;
  target_hit_at?: string | null;
  stop_hit_at?: string | null;
  recommendation_quality_grade?: string | null;
}

export interface PerformanceStats {
  total_recommendations: number;
  closed_recommendations: number;
  open_recommendations?: number;
  win_rate: number;
  avg_return_pct: number;
  median_return_pct?: number;
  expectancy: number;
  sharpe_ratio: number;
  profit_factor?: number;
  target_hit_rate?: number;
  stop_hit_rate?: number;
  calculation_window?: string;
  calibration_drift?: number | null;
}

export interface DashboardSummary {
  totalRecommendations: number;
  closedRecommendations: number;
  openPositions: number;
  stocksTracked: number;
  winRate?: number;
}

export interface MarketOverview {
  nifty?: {
    price?: number;
    change?: number;
  };
  sensex?: {
    price?: number;
    change?: number;
  };
  indiaVix?: {
    price?: number;
    change?: number;
  };
  marketStatus?: "OPEN" | "CLOSED" | string;
  lastUpdated?: string;
}

export interface SectorRotationItem {
  sector: string;
  topStock?: string;
  signal?: string;
  momentum?: "UP" | "DOWN" | "FLAT" | string;
  score?: number;
}

export interface TopPick {
  symbol: string;
  sector?: string;
  signal?: string;
  convictionScore?: number;
  riskLevel?: RiskLevel;
}
