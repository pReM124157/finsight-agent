import mongoose from "mongoose";

const strategyGuardReportSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "strategy_guard_reports",
  }
);

strategyGuardReportSchema.index({ date: 1 });
strategyGuardReportSchema.index({ reportDate: 1 });
strategyGuardReportSchema.index({ sessionId: 1 });
strategyGuardReportSchema.index({ strategyName: 1 });
strategyGuardReportSchema.index({ generatedAt: 1 });
strategyGuardReportSchema.index({ verdict: 1 });

export const StrategyGuardReport =
  mongoose.models.StrategyGuardReport ||
  mongoose.model("StrategyGuardReport", strategyGuardReportSchema);
