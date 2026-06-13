import express from "express";
import { generateStockReportPDF } from "../services/pdfReport.service.js";
import { buildStockReportPayload } from "../services/report.service.js";
import { createTraceId, logError, logEvent } from "../services/telemetry.service.js";

const router = express.Router();

router.get("/:symbol", async (req, res) => {
  const traceId = req.traceId || createTraceId("http_report");
  const symbol = String(req.params.symbol || "").trim().toUpperCase();

  if (!symbol) {
    return res.status(400).json({
      success: false,
      traceId,
      message: "Stock symbol is required"
    });
  }

  try {
    const reportPayload = await buildStockReportPayload(symbol);

    if (reportPayload.analysisData?.status === "VERIFIED_ANALYSIS_UNAVAILABLE") {
      return res.status(503).json({
        success: false,
        traceId,
        message: reportPayload.analysisData.message || `Verified analysis unavailable for ${symbol}`
      });
    }

    const pdfBuffer = await generateStockReportPDF(reportPayload);
    const filename = `Finsight_${symbol}_${new Date().toISOString().slice(0, 10)}.pdf`;

    logEvent("http.report.completed", {
      traceId,
      symbol,
      pdfBytes: pdfBuffer.length
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    return res.send(pdfBuffer);
  } catch (error) {
    logError("http.report.error", error, { traceId, symbol });
    return res.status(500).json({
      success: false,
      traceId,
      message: "Failed to generate PDF report"
    });
  }
});

export default router;
