import mongoose from "mongoose";

const systemSessionSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "system_sessions",
  }
);

systemSessionSchema.index({ sessionId: 1 });
systemSessionSchema.index({ pid: 1 });
systemSessionSchema.index({ status: 1 });
systemSessionSchema.index({ startedAt: 1 });
systemSessionSchema.index({ endedAt: 1 });

export const SystemSession =
  mongoose.models.SystemSession || mongoose.model("SystemSession", systemSessionSchema);
