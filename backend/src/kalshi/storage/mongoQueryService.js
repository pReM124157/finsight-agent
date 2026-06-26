import { getMongoConnectionState, isMongoEnabled } from "../../db/mongoClient.js";
import {
  PaperTrade,
  MarketSnapshot,
  FeatureSnapshot,
  LabeledSnapshot,
  StrategyGuardReport,
  NoSideShadowAudit,
  NoSideShadowReport,
  SystemSession,
} from "../models/index.js";

function mongoReady() {
  const state = getMongoConnectionState();
  return {
    ready: isMongoEnabled() && state.stateLabel === "connected",
    state,
  };
}

function buildMongoNotReady() {
  const { state } = mongoReady();
  return {
    ok: false,
    skipped: true,
    reason: "MONGO_NOT_READY",
    state,
  };
}

function toLimit(value, fallback = 50) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(500, Math.floor(parsed));
}

function toSkip(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function buildDateRange(field, filters = {}) {
  const from = safeString(filters.from);
  const to = safeString(filters.to);

  if (!from && !to) {
    return null;
  }

  const range = {};
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) {
      range.$gte = fromDate;
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) {
      range.$lte = toDate;
    }
  }

  return Object.keys(range).length > 0 ? { [field]: range } : null;
}

function appendDateRange(query, field, filters) {
  const clause = buildDateRange(field, filters);
  if (clause) {
    Object.assign(query, clause);
  }
}

async function runListQuery(Model, {
  filters = {},
  query = {},
  sort = { createdAt: -1 },
} = {}) {
  const { ready } = mongoReady();
  if (!ready) {
    return buildMongoNotReady();
  }

  const limit = toLimit(filters.limit, 50);
  const skip = toSkip(filters.skip, 0);
  const records = await Model.find(query)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    ok: true,
    count: records.length,
    limit,
    skip,
    records,
  };
}

export function getMongoStatus() {
  const { ready, state } = mongoReady();
  return {
    ok: ready,
    enabled: isMongoEnabled(),
    ready,
    state,
  };
}

export async function getMongoHealth() {
  const { ready, state } = mongoReady();
  if (!ready) {
    return buildMongoNotReady();
  }

  const [
    paperTrades,
    marketSnapshots,
    featureSnapshots,
    labeledSnapshots,
    strategyGuardReports,
    noSideShadowAudits,
    noSideShadowReports,
    systemSessions,
    paperTrade,
    marketSnapshot,
    featureSnapshot,
    labeledSnapshot,
    strategyGuardReport,
    noSideShadowAudit,
    noSideShadowReport,
    systemSession,
  ] = await Promise.all([
    PaperTrade.countDocuments(),
    MarketSnapshot.countDocuments(),
    FeatureSnapshot.countDocuments(),
    LabeledSnapshot.countDocuments(),
    StrategyGuardReport.countDocuments(),
    NoSideShadowAudit.countDocuments(),
    NoSideShadowReport.countDocuments(),
    SystemSession.countDocuments(),
    PaperTrade.findOne().sort({ createdAt: -1 }).lean(),
    MarketSnapshot.findOne().sort({ createdAt: -1, capturedAt: -1 }).lean(),
    FeatureSnapshot.findOne().sort({ createdAt: -1, capturedAt: -1, captured_at: -1 }).lean(),
    LabeledSnapshot.findOne().sort({ createdAt: -1, timestamp: -1 }).lean(),
    StrategyGuardReport.findOne().sort({ generatedAt: -1, createdAt: -1 }).lean(),
    NoSideShadowAudit.findOne().sort({ capturedAt: -1, createdAt: -1 }).lean(),
    NoSideShadowReport.findOne().sort({ generatedAt: -1, createdAt: -1 }).lean(),
    SystemSession.findOne().sort({ startedAt: -1, createdAt: -1 }).lean(),
  ]);

  return {
    ok: true,
    state,
    counts: {
      paperTrades,
      marketSnapshots,
      featureSnapshots,
      labeledSnapshots,
      strategyGuardReports,
      noSideShadowAudits,
      noSideShadowReports,
      systemSessions,
    },
    latest: {
      paperTrade,
      marketSnapshot,
      featureSnapshot,
      labeledSnapshot,
      strategyGuardReport,
      noSideShadowAudit,
      noSideShadowReport,
      systemSession,
    },
  };
}

export async function listPaperTradesMongo(filters = {}) {
  const query = {};
  if (safeString(filters.marketTicker)) query.marketTicker = safeString(filters.marketTicker);
  if (safeString(filters.strategySessionId)) query.strategySessionId = safeString(filters.strategySessionId);
  if (safeString(filters.strategyName)) query.strategyName = safeString(filters.strategyName);
  if (safeString(filters.tradeSource)) query.tradeSource = safeString(filters.tradeSource);
  if (safeString(filters.status)) query.status = safeString(filters.status);
  const isStrategyTrade = safeBoolean(filters.isStrategyTrade);
  if (isStrategyTrade !== null) query.isStrategyTrade = isStrategyTrade;
  appendDateRange(query, "openedAt", filters);
  return runListQuery(PaperTrade, { filters, query, sort: { openedAt: -1, createdAt: -1 } });
}

export async function listMarketSnapshotsMongo(filters = {}) {
  const query = {};
  if (safeString(filters.marketTicker)) {
    query.$or = [
      { marketTicker: safeString(filters.marketTicker) },
      { market_ticker: safeString(filters.marketTicker) },
    ];
  }
  appendDateRange(query, "capturedAt", filters);
  return runListQuery(MarketSnapshot, { filters, query, sort: { capturedAt: -1, createdAt: -1 } });
}

export async function listFeatureSnapshotsMongo(filters = {}) {
  const query = {};
  if (safeString(filters.marketTicker)) {
    query.$or = [
      { marketTicker: safeString(filters.marketTicker) },
      { market_ticker: safeString(filters.marketTicker) },
    ];
  }
  appendDateRange(query, "capturedAt", filters);
  return runListQuery(FeatureSnapshot, { filters, query, sort: { capturedAt: -1, captured_at: -1, createdAt: -1 } });
}

export async function listLabeledSnapshotsMongo(filters = {}) {
  const query = {};
  if (safeString(filters.marketTicker)) query.marketTicker = safeString(filters.marketTicker);
  if (safeString(filters.strategyName)) query.strategyName = safeString(filters.strategyName);
  if (safeString(filters.status)) query.label = safeString(filters.status);
  appendDateRange(query, "timestamp", filters);
  return runListQuery(LabeledSnapshot, { filters, query, sort: { timestamp: -1, createdAt: -1 } });
}

export async function listStrategyReportsMongo(filters = {}) {
  const query = {};
  if (safeString(filters.strategySessionId)) query.sessionId = safeString(filters.strategySessionId);
  if (safeString(filters.strategyName)) query.strategyName = safeString(filters.strategyName);
  if (safeString(filters.verdict)) query.verdict = safeString(filters.verdict);
  appendDateRange(query, "generatedAt", filters);
  return runListQuery(StrategyGuardReport, { filters, query, sort: { generatedAt: -1, createdAt: -1 } });
}

export async function listNoSideShadowAuditsMongo(filters = {}) {
  const query = {};
  if (safeString(filters.marketTicker)) query.marketTicker = safeString(filters.marketTicker);
  const candidate = safeBoolean(filters.candidate);
  if (candidate !== null) query.candidate = candidate;
  if (safeString(filters.rejectionReason)) {
    query.$or = [
      { rejectionReason: safeString(filters.rejectionReason) },
      { rejection_reason: safeString(filters.rejectionReason) },
    ];
  }
  appendDateRange(query, "capturedAt", filters);
  return runListQuery(NoSideShadowAudit, { filters, query, sort: { capturedAt: -1, createdAt: -1 } });
}

export async function listNoSideShadowReportsMongo(filters = {}) {
  const query = {};
  if (safeString(filters.verdict)) query.verdict = safeString(filters.verdict);
  appendDateRange(query, "generatedAt", filters);
  return runListQuery(NoSideShadowReport, { filters, query, sort: { generatedAt: -1, createdAt: -1 } });
}

export async function listSystemSessionsMongo(filters = {}) {
  const query = {};
  if (safeString(filters.strategySessionId)) query.sessionId = safeString(filters.strategySessionId);
  if (safeString(filters.status)) query.status = safeString(filters.status);
  appendDateRange(query, "startedAt", filters);
  return runListQuery(SystemSession, { filters, query, sort: { startedAt: -1, createdAt: -1 } });
}

export async function getLatestMongoRecords() {
  const { ready } = mongoReady();
  if (!ready) {
    return buildMongoNotReady();
  }

  const [
    paperTrade,
    marketSnapshot,
    featureSnapshot,
    labeledSnapshot,
    strategyGuardReport,
    noSideShadowAudit,
    noSideShadowReport,
    systemSession,
  ] = await Promise.all([
    PaperTrade.findOne().sort({ openedAt: -1, createdAt: -1 }).lean(),
    MarketSnapshot.findOne().sort({ capturedAt: -1, createdAt: -1 }).lean(),
    FeatureSnapshot.findOne().sort({ capturedAt: -1, captured_at: -1, createdAt: -1 }).lean(),
    LabeledSnapshot.findOne().sort({ timestamp: -1, createdAt: -1 }).lean(),
    StrategyGuardReport.findOne().sort({ generatedAt: -1, createdAt: -1 }).lean(),
    NoSideShadowAudit.findOne().sort({ capturedAt: -1, createdAt: -1 }).lean(),
    NoSideShadowReport.findOne().sort({ generatedAt: -1, createdAt: -1 }).lean(),
    SystemSession.findOne().sort({ startedAt: -1, createdAt: -1 }).lean(),
  ]);

  return {
    ok: true,
    records: {
      paperTrade,
      marketSnapshot,
      featureSnapshot,
      labeledSnapshot,
      strategyGuardReport,
      noSideShadowAudit,
      noSideShadowReport,
      systemSession,
    },
  };
}
