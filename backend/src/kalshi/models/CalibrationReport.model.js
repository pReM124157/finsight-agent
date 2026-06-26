import mongoose from "mongoose";

const calibrationReportSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "calibration_reports",
  }
);

calibrationReportSchema.index({ reportType: 1 });
calibrationReportSchema.index({ reportDate: 1 });
calibrationReportSchema.index({ generatedAt: 1 });
calibrationReportSchema.index({ verdict: 1 });

export const CalibrationReport =
  mongoose.models.CalibrationReport || mongoose.model("CalibrationReport", calibrationReportSchema);
