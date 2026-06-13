import PDFDocument from "pdfkit";

const COLORS = {
  bgDark: "#080B11",
  bgSurface: "#0E1219",
  border: "#1E2738",
  accentBlue: "#3B82F6",
  accentGreen: "#10B981",
  accentRed: "#EF4444",
  accentAmber: "#F59E0B",
  textPrimary: "#F1F5F9",
  textSecondary: "#94A3B8",
  textMuted: "#475569"
};

function safeText(value, fallback = "N/A") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function safeNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatINR(value) {
  const numeric = safeNumber(value);
  if (numeric == null) return "N/A";
  return `Rs ${numeric.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPercent(value) {
  const numeric = safeNumber(value);
  if (numeric == null) return "N/A";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function getActionColor(action = "") {
  const normalized = safeText(action, "").toUpperCase();
  if (normalized.includes("BUY")) return COLORS.accentGreen;
  if (normalized.includes("SELL") || normalized.includes("EXIT")) return COLORS.accentRed;
  return COLORS.accentAmber;
}

function drawBackground(doc) {
  const { width, height } = doc.page;
  doc.save().fillColor(COLORS.bgDark).rect(0, 0, width, height).fill().restore();
  doc.save().fillColor(COLORS.accentBlue).rect(0, 0, width / 2, 3).fill().restore();
  doc.save().fillColor(COLORS.accentGreen).rect(width / 2, 0, width / 2, 3).fill().restore();
}

function drawLabel(doc, text, x, y, options = {}) {
  doc
    .font(options.font || "Helvetica")
    .fontSize(options.size || 7)
    .fillColor(options.color || COLORS.textMuted)
    .text(safeText(text).toUpperCase(), x, y, {
      width: options.width,
      characterSpacing: options.characterSpacing ?? 0.8
    });
}

function drawValue(doc, text, x, y, options = {}) {
  doc
    .font(options.font || "Helvetica-Bold")
    .fontSize(options.size || 11)
    .fillColor(options.color || COLORS.textPrimary)
    .text(safeText(text), x, y, {
      width: options.width,
      lineGap: options.lineGap ?? 0
    });
}

function drawLine(doc, x1, y1, x2, y2, color = COLORS.border, width = 0.5) {
  doc.save().strokeColor(color).lineWidth(width).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
}

function drawCard(doc, x, y, w, h, options = {}) {
  const radius = options.radius ?? 4;
  doc.save().fillColor(options.bg || COLORS.bgSurface).roundedRect(x, y, w, h, radius).fill().restore();
  doc.save().strokeColor(options.borderColor || COLORS.border).lineWidth(0.5).roundedRect(x, y, w, h, radius).stroke().restore();
}

function drawMetricBox(doc, x, y, w, label, value, valueColor = COLORS.textPrimary) {
  drawCard(doc, x, y, w, 52);
  drawLabel(doc, label, x + 10, y + 10);
  drawValue(doc, value, x + 10, y + 24, { color: valueColor, size: 13, width: w - 20 });
}

function drawSectionHeader(doc, text, y) {
  const { width } = doc.page;
  drawLine(doc, 40, y, width - 40, y);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.accentBlue).text(safeText(text).toUpperCase(), 40, y + 6, {
    characterSpacing: 1.1
  });
  return y + 22;
}

function toSentence(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => safeText(item, "")).join(", ") || "N/A";
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "N/A";
    }
  }
  return safeText(value);
}

function normalizeReportData(reportPayload = {}) {
  const analysisData = reportPayload.analysisData || {};
  const stockData = reportPayload.stockData || {};
  const decision = analysisData.decision || {};
  const risk = analysisData.risk || {};
  const entryTiming = analysisData.entryTiming || {};
  const exitSignal = analysisData.exitSignal || {};
  const learning = analysisData.learning || {};
  const performance = analysisData.performance || {};
  const rebalancing = analysisData.rebalancing || {};
  const portfolio = analysisData.portfolio || {};

  return {
    stock: reportPayload.symbol || analysisData.stock || analysisData.symbol || stockData.Symbol || "UNKNOWN",
    currentPrice: safeNumber(
      analysisData.currentPrice ??
        entryTiming.currentPrice ??
        analysisData.technical?.currentPrice ??
        stockData.currentPrice ??
        stockData.CurrentPrice
    ),
    action: decision.finalDecision || decision.finalAction || analysisData.action || "HOLD",
    confidence: safeNumber(decision.finalConfidenceScore ?? decision.confidenceScore ?? analysisData.confidence),
    reasoning: decision.reason || decision.reasoning || analysisData.reason || analysisData.message,
    risk: {
      riskLevel: risk.riskLevel,
      riskScore: safeNumber(risk.riskScore),
      majorRisks: risk.majorRisks
    },
    entryTiming: {
      entryStrategy: entryTiming.strategy || entryTiming.entryStrategy || entryTiming.finalExecutionAdvice,
      stopLoss: entryTiming.stopLoss,
      target: entryTiming.initialTarget || entryTiming.targetPrice,
      rewardRiskRatio: entryTiming.rewardRiskRatio
    },
    exitSignal: {
      signal: exitSignal.signal || exitSignal.action
    },
    capitalAction: analysisData.capitalAction,
    analysis: {
      stockFundamentals:
        analysisData.analysis?.stockFundamentals ||
        analysisData.analysis?.researchNarrative ||
        analysisData.reason ||
        analysisData.message
    },
    learning,
    performance,
    rebalancing,
    portfolio
  };
}

function buildCoverPage(doc, reportPayload) {
  const data = normalizeReportData(reportPayload);
  const { width, height } = doc.page;
  drawBackground(doc);

  drawLabel(doc, "Finsight AI - Institutional Stock Intelligence", 40, 24, {
    color: COLORS.textMuted,
    size: 7.5
  });

  const generatedAt =
    new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) + " IST";

  doc.font("Helvetica").fontSize(7).fillColor(COLORS.textMuted).text(generatedAt, 40, 24, {
    align: "right",
    width: width - 80
  });

  doc.font("Helvetica-Bold").fontSize(52).fillColor(COLORS.textPrimary).text(data.stock, 40, 80);

  if (data.currentPrice != null) {
    doc.font("Helvetica").fontSize(18).fillColor(COLORS.accentGreen).text(formatINR(data.currentPrice), 40, 142);
  }

  const badgeY = data.currentPrice != null ? 172 : 150;
  const actionColor = getActionColor(data.action);
  doc.save().fillColor(actionColor).fillOpacity(0.15).roundedRect(40, badgeY, 120, 28, 4).fill().restore();
  doc.save().strokeColor(actionColor).lineWidth(0.8).roundedRect(40, badgeY, 120, 28, 4).stroke().restore();
  doc.font("Helvetica-Bold").fontSize(11).fillColor(actionColor).text(data.action, 50, badgeY + 8);

  if (data.confidence != null) {
    drawLabel(doc, "Confidence Score", 40, badgeY + 40);
    drawValue(doc, `${data.confidence}/10`, 40, badgeY + 52, { size: 16 });
  }

  drawLine(doc, 40, 290, width - 40, 290);

  const metrics = [
    { label: "Risk Level", value: safeText(data.risk.riskLevel), color: COLORS.textPrimary },
    { label: "Risk Score", value: data.risk.riskScore == null ? "N/A" : `${data.risk.riskScore}/10`, color: COLORS.textPrimary },
    { label: "Entry Strategy", value: safeText(data.entryTiming.entryStrategy), color: COLORS.accentAmber },
    { label: "Exit Signal", value: safeText(data.exitSignal.signal), color: COLORS.accentRed }
  ];

  const boxW = (width - 80 - 18) / 4;
  metrics.forEach((metric, index) => {
    drawMetricBox(doc, 40 + index * (boxW + 6), 306, boxW, metric.label, metric.value, metric.color);
  });

  let y = 380;
  y = drawSectionHeader(doc, "Master Agent Reasoning", y);
  drawCard(doc, 40, y, width - 80, 100);
  doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.textSecondary).text(toSentence(data.reasoning || "No reasoning provided."), 52, y + 12, {
    width: width - 104,
    height: 80,
    lineGap: 2,
    ellipsis: true
  });

  y += 116;
  if (data.capitalAction) {
    y = drawSectionHeader(doc, "Capital Action", y);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.accentAmber).text(safeText(data.capitalAction), 40, y, {
      width: width - 80
    });
  }

  drawLine(doc, 40, height - 40, width - 40, height - 40);
  drawLabel(
    doc,
    "This report is generated by Finsight AI for informational purposes only. Not investment advice. SEBI registration required for advisory use.",
    40,
    height - 28,
    { color: COLORS.textMuted, size: 6.5, width: width - 80, characterSpacing: 0 }
  );
}

function buildAnalysisPage(doc, reportPayload) {
  const data = normalizeReportData(reportPayload);
  const { width, height } = doc.page;
  drawBackground(doc);

  let y = 30;
  drawLabel(doc, `${data.stock} - Detailed Analysis`, 40, y, { color: COLORS.textMuted });
  y += 20;

  y = drawSectionHeader(doc, "Stock Fundamentals", y);
  drawCard(doc, 40, y, width - 80, 130);
  doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.textSecondary).text(toSentence(data.analysis.stockFundamentals || "Fundamental data unavailable."), 52, y + 12, {
    width: width - 104,
    height: 112,
    lineGap: 2,
    ellipsis: true
  });
  y += 146;

  y = drawSectionHeader(doc, "Agent Analysis Grid", y);
  const agents = [
    { title: "Research Agent", content: toSentence(data.analysis.stockFundamentals || "No data").slice(0, 220) },
    {
      title: "Risk Agent",
      content: `Risk: ${safeText(data.risk.riskLevel)} | Score: ${data.risk.riskScore ?? "N/A"}/10\n${toSentence(data.risk.majorRisks || "No risk data").slice(0, 160)}`
    },
    {
      title: "Learning Agent",
      content: `Boost: +${safeNumber(data.learning.learningBoost ?? data.learning.confidenceBoost, 0)}\n${safeText(data.learning.learningInsight, "No insight")}`
    },
    {
      title: "Performance Agent",
      content: `Score: ${safeNumber(data.performance.performanceScore, 0)}\n${safeText(data.performance.performanceInsight, "No insight")}`
    },
    {
      title: "Portfolio Agent",
      content: `Health: ${safeText(data.portfolio.healthScore)}/10\nSector: ${safeText(data.portfolio.dominantSector)}`
    },
    {
      title: "Rebalancing Agent",
      content: safeText(data.rebalancing.rebalancingAdvice, "No rebalancing needed.")
    }
  ];

  const colW = (width - 80 - 10) / 2;
  const cardH = 88;
  agents.forEach((agent, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const cardX = 40 + col * (colW + 10);
    const cardY = y + row * (cardH + 8);
    drawCard(doc, cardX, cardY, colW, cardH);
    doc.save().fillColor(COLORS.accentBlue).rect(cardX, cardY, 2, cardH).fill().restore();
    drawLabel(doc, agent.title, cardX + 12, cardY + 10, { color: COLORS.accentBlue, size: 7 });
    doc.font("Helvetica").fontSize(7.5).fillColor(COLORS.textSecondary).text(agent.content, cardX + 12, cardY + 24, {
      width: colW - 24,
      height: cardH - 32,
      lineGap: 1.5,
      ellipsis: true
    });
  });

  y += Math.ceil(agents.length / 2) * (cardH + 8) + 16;
  if (data.rebalancing.rebalancingAdvice && y < height - 110) {
    y = drawSectionHeader(doc, "Rebalancing Advice", y);
    drawCard(doc, 40, y, width - 80, 56);
    doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.accentAmber).text(safeText(data.rebalancing.rebalancingAdvice), 52, y + 10, {
      width: width - 104,
      height: 38,
      ellipsis: true
    });
  }

  drawLine(doc, 40, height - 40, width - 40, height - 40);
  drawLabel(doc, "Finsight AI - Not investment advice - For informational use only", 40, height - 28, {
    color: COLORS.textMuted,
    size: 6.5
  });
}

function buildPerformancePage(doc, performanceStats) {
  if (!performanceStats) return;
  const { width, height } = doc.page;
  drawBackground(doc);

  let y = 30;
  drawLabel(doc, "Finsight AI - System Performance", 40, y, { color: COLORS.textMuted });
  y += 20;
  y = drawSectionHeader(doc, "Statistical Validation", y);

  const metrics = [
    { label: "Total Recommendations", value: safeText(performanceStats.total_recommendations), color: COLORS.textPrimary },
    { label: "Closed", value: safeText(performanceStats.closed_recommendations), color: COLORS.textPrimary },
    { label: "Win Rate", value: formatPercent(performanceStats.win_rate), color: Number(performanceStats.win_rate) > 50 ? COLORS.accentGreen : COLORS.accentAmber },
    { label: "Expectancy", value: formatPercent(performanceStats.expectancy), color: Number(performanceStats.expectancy) > 0 ? COLORS.accentGreen : COLORS.accentRed },
    { label: "Avg Return", value: formatPercent(performanceStats.avg_return_pct), color: Number(performanceStats.avg_return_pct) > 0 ? COLORS.accentGreen : COLORS.accentRed },
    { label: "Sharpe Ratio", value: safeNumber(performanceStats.sharpe_ratio) == null ? "N/A" : Number(performanceStats.sharpe_ratio).toFixed(2), color: COLORS.textPrimary }
  ];

  const boxW = (width - 80 - 25) / 3;
  metrics.forEach((metric, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawMetricBox(doc, 40 + col * (boxW + 12.5), y + row * 64, boxW, metric.label, metric.value, metric.color);
  });

  y += Math.ceil(metrics.length / 3) * 64 + 20;
  drawCard(doc, 40, y, width - 80, 56, { borderColor: COLORS.accentAmber });
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(COLORS.accentAmber).text("CALIBRATION NOTE", 52, y + 12, {
    characterSpacing: 0.8
  });
  doc.font("Helvetica").fontSize(8).fillColor(COLORS.textSecondary).text(
    "Model performance is shown from the latest internal analytics snapshot. Treat it as an operating calibration view, not a promise of future outcomes.",
    52,
    y + 24,
    { width: width - 104, lineGap: 1.5 }
  );

  y += 72;
  y = drawSectionHeader(doc, "Disclaimer", y);
  doc.font("Helvetica").fontSize(7.5).fillColor(COLORS.textMuted).text(
    "Past performance is not indicative of future results. Finsight AI is not a SEBI-registered investment advisor. This report is for informational purposes only and does not constitute investment advice.",
    40,
    y,
    { width: width - 80, lineGap: 2 }
  );

  drawLine(doc, 40, height - 40, width - 40, height - 40);
  drawLabel(doc, `Finsight AI - Statistical Validation Report - Generated ${new Date().toLocaleDateString("en-IN")}`, 40, height - 28, {
    color: COLORS.textMuted,
    size: 6.5
  });
}

export async function generateStockReportPDF(reportPayload) {
  if (!reportPayload?.analysisData) {
    throw new Error("REPORT_DATA_REQUIRED");
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        info: {
          Title: `Finsight AI - ${reportPayload.symbol || "Stock"} Analysis Report`,
          Author: "Finsight AI",
          Subject: "Institutional Stock Intelligence Report",
          Creator: "Finsight AI Backend"
        }
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      buildCoverPage(doc, reportPayload);
      doc.addPage();
      buildAnalysisPage(doc, reportPayload);

      if (reportPayload.performanceStats) {
        doc.addPage();
        buildPerformancePage(doc, reportPayload.performanceStats);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
