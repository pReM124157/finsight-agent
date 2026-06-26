import mongoose from "mongoose";

const noSideShadowReportSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "no_side_shadow_reports",
  }
);

noSideShadowReportSchema.index({ reportDate: 1 });
noSideShadowReportSchema.index({ generatedAt: 1 });
noSideShadowReportSchema.index({ verdict: 1 });

export const NoSideShadowReport =
  mongoose.models.NoSideShadowReport ||
  mongoose.model("NoSideShadowReport", noSideShadowReportSchema);
