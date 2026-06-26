import mongoose from "mongoose";

const noSideShadowAuditSchema = new mongoose.Schema(
  {},
  {
    strict: false,
    timestamps: true,
    collection: "no_side_shadow_audits",
  }
);

noSideShadowAuditSchema.index({ id: 1 });
noSideShadowAuditSchema.index({ createdAt: 1 });
noSideShadowAuditSchema.index({ capturedAt: 1 });
noSideShadowAuditSchema.index({ marketTicker: 1 });
noSideShadowAuditSchema.index({ candidate: 1 });
noSideShadowAuditSchema.index({ rejectionReason: 1 });
noSideShadowAuditSchema.index({ settlementOutcome: 1 });
noSideShadowAuditSchema.index({ settlement_outcome: 1 });

export const NoSideShadowAudit =
  mongoose.models.NoSideShadowAudit ||
  mongoose.model("NoSideShadowAudit", noSideShadowAuditSchema);
