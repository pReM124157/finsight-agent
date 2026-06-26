import mongoose from "mongoose";

const labeledSnapshotSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "labeled_snapshots",
  }
);

labeledSnapshotSchema.index({ id: 1 });
labeledSnapshotSchema.index({ snapshotId: 1 });
labeledSnapshotSchema.index({ marketTicker: 1 });
labeledSnapshotSchema.index({ timestamp: 1 });
labeledSnapshotSchema.index({ label: 1 });
labeledSnapshotSchema.index({ strategyName: 1 });

export const LabeledSnapshot =
  mongoose.models.LabeledSnapshot || mongoose.model("LabeledSnapshot", labeledSnapshotSchema);
