import mongoose from "mongoose";

const paperTradeSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "paper_trades",
  }
);

paperTradeSchema.index({ id: 1 });
paperTradeSchema.index({ tradeId: 1 });
paperTradeSchema.index({ createdAt: 1 });
paperTradeSchema.index({ openedAt: 1 });
paperTradeSchema.index({ closedAt: 1 });
paperTradeSchema.index({ status: 1 });
paperTradeSchema.index({ strategySessionId: 1 });
paperTradeSchema.index({ strategyName: 1 });
paperTradeSchema.index({ tradeSource: 1 });
paperTradeSchema.index({ isStrategyTrade: 1 });
paperTradeSchema.index({ marketTicker: 1 });

export const PaperTrade =
  mongoose.models.PaperTrade || mongoose.model("PaperTrade", paperTradeSchema);
