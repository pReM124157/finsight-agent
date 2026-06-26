import mongoose from "mongoose";

const marketSnapshotSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "market_snapshots",
  }
);

marketSnapshotSchema.index({ id: 1 });
marketSnapshotSchema.index({ createdAt: 1 });
marketSnapshotSchema.index({ capturedAt: 1 });
marketSnapshotSchema.index({ marketTicker: 1 });
marketSnapshotSchema.index({ pipeline_version: 1 });
marketSnapshotSchema.index({ pipelineVersion: 1 });
marketSnapshotSchema.index({ sessionId: 1 });

export const MarketSnapshot =
  mongoose.models.MarketSnapshot || mongoose.model("MarketSnapshot", marketSnapshotSchema);
