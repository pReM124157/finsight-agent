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

export function isMongoDualWriteEnabled() {
  return process.env.MONGODB_DUAL_WRITE === "true";
}

function buildMongoNotReady() {
  return {
    ok: false,
    skipped: true,
    reason: "MONGO_NOT_READY",
    state: getMongoConnectionState(),
  };
}

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeValue(value, fallback = null) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

export function canWriteMongo() {
  const state = getMongoConnectionState();
  return isMongoEnabled() && state.stateLabel === "connected";
}

export function getRecordKey(record = {}, preferredKeys = []) {
  const keys = [
    ...preferredKeys,
    "id",
    "tradeId",
    "snapshotId",
    "snapshot_id",
    "sessionId",
    "reportDate",
    "date",
    "generatedAt",
  ];

  for (const key of keys) {
    const value = safeValue(record?.[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function withMongoUpdateMetadata(record = {}) {
  return {
    ...record,
    updatedAtMongo: new Date().toISOString(),
  };
}

function buildFallbackFilter(record = {}, preferredKeys = []) {
  const key = getRecordKey(record, preferredKeys);
  return {
    _mongoKey: key || `MONGO_FALLBACK_${Date.now()}_${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
  };
}

export async function safeUpsert(Model, filter, record, label) {
  if (!canWriteMongo()) {
    return buildMongoNotReady();
  }

  try {
    const saved = await Model.findOneAndUpdate(
      filter,
      { $set: withMongoUpdateMetadata(record) },
      { upsert: true, returnDocument: "after" }
    );

    return {
      ok: true,
      collection: Model.collection.name,
      id: saved?.id || saved?._id?.toString() || null,
    };
  } catch (error) {
    return {
      ok: false,
      collection: Model.collection?.name || null,
      error: error.message,
      label,
    };
  }
}

export async function savePaperTradeMongo(record = {}) {
  const filter =
    safeValue(record.id) !== null
      ? { id: record.id }
      : safeValue(record.tradeId) !== null
        ? { tradeId: record.tradeId }
        : buildFallbackFilter(record, ["id", "tradeId"]);

  return safeUpsert(PaperTrade, filter, record, "savePaperTradeMongo");
}

export async function updatePaperTradeMongo(id, updates = {}) {
  if (!canWriteMongo()) {
    return buildMongoNotReady();
  }

  try {
    const saved = await PaperTrade.findOneAndUpdate(
      { $or: [{ id }, { tradeId: id }] },
      { $set: withMongoUpdateMetadata(updates) },
      { returnDocument: "after" }
    );

    return {
      ok: true,
      collection: PaperTrade.collection.name,
      id: saved?.id || saved?._id?.toString() || id || null,
    };
  } catch (error) {
    return {
      ok: false,
      collection: PaperTrade.collection.name,
      error: error.message,
      label: "updatePaperTradeMongo",
    };
  }
}

export async function saveMarketSnapshotMongo(record = {}) {
  const filter =
    safeValue(record.id) !== null
      ? { id: record.id }
      : safeValue(record.snapshotId) !== null
        ? { snapshotId: record.snapshotId }
        : safeValue(record.snapshot_id) !== null
          ? { snapshot_id: record.snapshot_id }
          : buildFallbackFilter(record, ["id", "snapshotId", "snapshot_id"]);

  return safeUpsert(MarketSnapshot, filter, record, "saveMarketSnapshotMongo");
}

export async function saveFeatureSnapshotMongo(record = {}) {
  const filter =
    safeValue(record.id) !== null
      ? { id: record.id }
      : safeValue(record.snapshot_id) !== null
        ? { snapshot_id: record.snapshot_id }
        : safeValue(record.snapshotId) !== null
          ? { snapshotId: record.snapshotId }
          : buildFallbackFilter(record, ["id", "snapshot_id", "snapshotId"]);

  return safeUpsert(FeatureSnapshot, filter, record, "saveFeatureSnapshotMongo");
}

export async function saveLabeledSnapshotMongo(record = {}) {
  const filter =
    safeValue(record.id) !== null
      ? { id: record.id }
      : safeValue(record.snapshotId) !== null
        ? { snapshotId: record.snapshotId }
        : buildFallbackFilter(record, ["id", "snapshotId"]);

  return safeUpsert(LabeledSnapshot, filter, record, "saveLabeledSnapshotMongo");
}

export async function saveStrategyGuardReportMongo(record = {}) {
  const reportDate = safeValue(record.reportDate, safeValue(record.date));
  const sessionId = safeValue(record.sessionId, null);
  const strategyName = safeValue(record.strategyName, null);

  const filter = reportDate !== null
    ? {
        reportDate,
        sessionId,
        strategyName,
      }
    : safeValue(record.generatedAt) !== null
      ? { generatedAt: record.generatedAt }
      : buildFallbackFilter(record, ["reportDate", "date", "generatedAt"]);

  return safeUpsert(StrategyGuardReport, filter, record, "saveStrategyGuardReportMongo");
}

export async function saveNoSideShadowAuditMongo(record = {}) {
  const capturedAt = safeValue(record.capturedAt, safeValue(record.createdAt));
  const marketTicker = safeString(record.marketTicker);

  const filter =
    safeValue(record.id) !== null
      ? { id: record.id }
      : marketTicker && capturedAt
        ? { marketTicker, capturedAt }
        : buildFallbackFilter(record, ["id", "marketTicker", "capturedAt", "createdAt"]);

  return safeUpsert(NoSideShadowAudit, filter, record, "saveNoSideShadowAuditMongo");
}

export async function saveNoSideShadowReportMongo(record = {}) {
  const reportDate = safeValue(record.reportDate, safeValue(record.date));
  const generatedAt = safeValue(record.generatedAt);

  const filter = reportDate && generatedAt
    ? { reportDate, generatedAt }
    : generatedAt
      ? { generatedAt }
      : buildFallbackFilter(record, ["reportDate", "date", "generatedAt"]);

  return safeUpsert(NoSideShadowReport, filter, record, "saveNoSideShadowReportMongo");
}

export async function saveSystemSessionMongo(record = {}) {
  const sessionId = safeValue(record.sessionId);
  const pid = safeValue(record.pid);
  const startedAt = safeValue(record.startedAt);

  const filter = sessionId !== null
    ? { sessionId }
    : pid !== null && startedAt !== null
      ? { pid, startedAt }
      : buildFallbackFilter(record, ["sessionId", "pid", "startedAt"]);

  return safeUpsert(SystemSession, filter, record, "saveSystemSessionMongo");
}

export async function updateSystemSessionMongo(sessionId, updates = {}) {
  if (!canWriteMongo()) {
    return buildMongoNotReady();
  }

  try {
    const saved = await SystemSession.findOneAndUpdate(
      { sessionId },
      { $set: withMongoUpdateMetadata(updates) },
      { returnDocument: "after" }
    );

    return {
      ok: true,
      collection: SystemSession.collection.name,
      id: saved?.sessionId || saved?._id?.toString() || sessionId || null,
    };
  } catch (error) {
    return {
      ok: false,
      collection: SystemSession.collection.name,
      error: error.message,
      label: "updateSystemSessionMongo",
    };
  }
}

export async function getMongoStats() {
  const state = getMongoConnectionState();
  if (!canWriteMongo()) {
    return {
      ok: false,
      skipped: true,
      reason: "MONGO_NOT_READY",
      state,
    };
  }

  try {
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
      featureSnapshot,
      strategyGuardReport,
      noSideShadowAudit,
    ] = await Promise.all([
      PaperTrade.countDocuments(),
      MarketSnapshot.countDocuments(),
      FeatureSnapshot.countDocuments(),
      LabeledSnapshot.countDocuments(),
      StrategyGuardReport.countDocuments(),
      NoSideShadowAudit.countDocuments(),
      NoSideShadowReport.countDocuments(),
      SystemSession.countDocuments(),
      PaperTrade.findOne().sort({ createdAt: -1 }),
      FeatureSnapshot.findOne().sort({ createdAt: -1 }),
      StrategyGuardReport.findOne().sort({ generatedAt: -1, createdAt: -1 }),
      NoSideShadowAudit.findOne().sort({ capturedAt: -1, createdAt: -1 }),
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
        featureSnapshot,
        strategyGuardReport,
        noSideShadowAudit,
      },
    };
  } catch (error) {
    return {
      ok: false,
      state,
      error: error.message,
    };
  }
}
