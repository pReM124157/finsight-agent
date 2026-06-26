import mongoose from "mongoose";

const featureSnapshotSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "feature_snapshots",
  }
);

featureSnapshotSchema.index({ id: 1 });
featureSnapshotSchema.index({ snapshot_id: 1 });
featureSnapshotSchema.index({ snapshotId: 1 });
featureSnapshotSchema.index({ createdAt: 1 });
featureSnapshotSchema.index({ captured_at: 1 });
featureSnapshotSchema.index({ capturedAt: 1 });
featureSnapshotSchema.index({ market_ticker: 1 });
featureSnapshotSchema.index({ marketTicker: 1 });
featureSnapshotSchema.index({ pipeline_version: 1 });
featureSnapshotSchema.index({ pipelineVersion: 1 });
featureSnapshotSchema.index({ settlement_outcome: 1 });
featureSnapshotSchema.index({ settlementOutcome: 1 });

export const FeatureSnapshot =
  mongoose.models.FeatureSnapshot || mongoose.model("FeatureSnapshot", featureSnapshotSchema);
