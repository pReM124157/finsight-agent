/**
 * INSTITUTIONAL OUTPUT INTEGRATION TESTS
 * Validates the institutional intelligence interpretation engine
 */

import { describe, test, expect } from "vitest";

import {
  classifyInstitutionalConfidence,
  computeFundamentalQualityScore,
  computeValuationInterpretation,
  computeBalanceSheetInterpretation,
  computeGrowthInterpretation,
  buildInstitutionalFundamentalNarrative,
  computeInstitutionalFactorWeights,
  buildGovernanceExplanation,
  buildEvidenceConstraintSummary,
  buildDecisionTrace
} from "../../src/services/institutionalInterpretation.service.js";

// ─── CONVICTION CLASSIFIER ────────────────────────────────────────────────────

describe("classifyInstitutionalConfidence", () => {
  test("≥85 → HIGH CONVICTION", () => {
    expect(classifyInstitutionalConfidence(90).label).toBe("HIGH CONVICTION");
  });
  test("70–84 → MODERATE CONVICTION", () => {
    expect(classifyInstitutionalConfidence(75).label).toBe("MODERATE CONVICTION");
  });
  test("55–69 → CONDITIONAL", () => {
    expect(classifyInstitutionalConfidence(60).label).toBe("CONDITIONAL");
  });
  test("40–54 → LOW CONFIDENCE", () => {
    expect(classifyInstitutionalConfidence(45).label).toBe("LOW CONFIDENCE");
  });
  test("<40 → NON-DEPLOYABLE", () => {
    expect(classifyInstitutionalConfidence(30).label).toBe("NON-DEPLOYABLE");
  });
  test("non-finite → NON-DEPLOYABLE", () => {
    expect(classifyInstitutionalConfidence(NaN).label).toBe("NON-DEPLOYABLE");
  });
});

// ─── FUNDAMENTAL QUALITY SCORE ────────────────────────────────────────────────

describe("computeFundamentalQualityScore", () => {
  test("TCS-like profile → INSTITUTIONAL GRADE", () => {
    const r = computeFundamentalQualityScore({
      roe: 48.4, profitMargin: 18.4, revenueGrowth: 10.2, earningsGrowth: 12.5, debtEquity: 0.08, pe: 24
    });
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.quality_class).toBe("INSTITUTIONAL GRADE");
    expect(r.drivers.length).toBeGreaterThan(0);
  });

  test("Weak company profile → CAUTION or AVOID GRADE", () => {
    const r = computeFundamentalQualityScore({
      roe: -5, profitMargin: -3, revenueGrowth: -8, earningsGrowth: -15, debtEquity: 4.2, pe: 0
    });
    expect(r.score).toBeLessThan(40);
    expect(r.risks.length).toBeGreaterThan(0);
  });

  test("Handles missing metrics gracefully", () => {
    const r = computeFundamentalQualityScore({});
    expect(r.score).toBeDefined();
    expect(r.quality_class).toBeDefined();
  });

  test("Score clamped between 0 and 100", () => {
    const high = computeFundamentalQualityScore({ roe: 200, profitMargin: 200, revenueGrowth: 200, earningsGrowth: 200, debtEquity: 0, pe: 5 });
    expect(high.score).toBeLessThanOrEqual(100);
    const low = computeFundamentalQualityScore({ roe: -200, profitMargin: -200, revenueGrowth: -200, earningsGrowth: -200, debtEquity: 20, pe: 0 });
    expect(low.score).toBeGreaterThanOrEqual(0);
  });
});

// ─── VALUATION INTERPRETATION ─────────────────────────────────────────────────

describe("computeValuationInterpretation", () => {
  test("P/E 10 for non-IT → UNDERVALUED", () => {
    const r = computeValuationInterpretation({ pe: 10, sector: "Consumer Goods" });
    expect(r.classification).toBe("UNDERVALUED");
  });
  test("P/E 24 for IT sector → REASONABLE", () => {
    const r = computeValuationInterpretation({ pe: 24, sector: "Information Technology" });
    expect(r.classification).toBe("REASONABLE");
  });
  test("P/E 60 → EXPENSIVE", () => {
    const r = computeValuationInterpretation({ pe: 60, sector: "Consumer" });
    expect(r.classification).toBe("EXPENSIVE");
  });
  test("Negative P/E → INSUFFICIENT DATA", () => {
    const r = computeValuationInterpretation({ pe: -5 });
    expect(r.classification).toBe("INSUFFICIENT DATA");
  });
  test("Banking sector uses tighter thresholds", () => {
    const r = computeValuationInterpretation({ pe: 7, sector: "Banking" });
    expect(r.classification).toBe("UNDERVALUED");
  });
});

// ─── BALANCE SHEET INTERPRETATION ────────────────────────────────────────────

describe("computeBalanceSheetInterpretation", () => {
  test("D/E 0.05 → DEBT-FREE PROFILE, no stress", () => {
    const r = computeBalanceSheetInterpretation({ debtEquity: 0.05 });
    expect(r.leverage_quality).toBe("DEBT-FREE PROFILE");
    expect(r.stress).toBe(false);
  });
  test("D/E 4 → EXCESSIVE LEVERAGE, stress flagged", () => {
    const r = computeBalanceSheetInterpretation({ debtEquity: 4 });
    expect(r.stress).toBe(true);
    expect(r.financing_risk).toBe("CRITICAL");
  });
  test("Missing D/E → UNKNOWN classification", () => {
    const r = computeBalanceSheetInterpretation({});
    expect(r.leverage_quality).toBe("UNKNOWN");
  });
});

// ─── GROWTH INTERPRETATION ────────────────────────────────────────────────────

describe("computeGrowthInterpretation", () => {
  test("EPS > rev → margin expansion detected", () => {
    const r = computeGrowthInterpretation({ revenueGrowth: 10, earningsGrowth: 22 });
    expect(r.marginExpansion).toBe(true);
    expect(r.acceleration).toBe(true);
  });
  test("Rev >> EPS → margin compression flagged", () => {
    const r = computeGrowthInterpretation({ revenueGrowth: 25, earningsGrowth: 5 });
    expect(r.narrative).toContain("margin compression");
  });
  test("Both missing → UNKNOWN", () => {
    const r = computeGrowthInterpretation({});
    expect(r.growth_class).toBe("UNKNOWN");
  });
  test("Negative earnings → CONTRACTING", () => {
    const r = computeGrowthInterpretation({ earningsGrowth: -10 });
    expect(r.growth_class).toBe("CONTRACTING");
  });
});

// ─── EVIDENCE CONSTRAINT SUMMARY — NO SPAM ───────────────────────────────────

describe("buildEvidenceConstraintSummary", () => {
  test("All available → one clean sentence, no spam", () => {
    const r = buildEvidenceConstraintSummary({
      replayStatus: "AVAILABLE", calibrationStatus: "AVAILABLE",
      driftStatus: "AVAILABLE", benchmarkStatus: "AVAILABLE"
    });
    expect(r).toBe("Institutional reliability conditions are fully satisfied across all evidence dimensions.");
  });

  test("Multiple constraints → single compact paragraph", () => {
    const r = buildEvidenceConstraintSummary({
      replayStatus: "INSUFFICIENT_REPLAY_DEPTH",
      calibrationStatus: "INSUFFICIENT_DATA",
      driftStatus: "NOT_AVAILABLE_IN_THIS_PATH",
      benchmarkStatus: "NOT_AVAILABLE_IN_THIS_PATH"
    });
    // Must be exactly ONE paragraph, not multiple bullet points
    expect(r.split("\n").length).toBe(1);
    expect(r).toContain("limited replay depth");
    expect(r).toContain("incomplete calibration data");
  });
});

// ─── GOVERNANCE EXPLANATION ───────────────────────────────────────────────────

describe("buildGovernanceExplanation", () => {
  test("Low confidence + replay missing → blocks deployment with explicit reasons", () => {
    const r = buildGovernanceExplanation({
      replayStatus: "INSUFFICIENT_REPLAY_DEPTH",
      adaptiveScore: 32,
      isLive: false,
      tradabilityHold: true,
      eventRisk: "LOW",
      calibrationStatus: "INSUFFICIENT_DATA"
    });
    expect(r.blocked).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(1);
    expect(r.formatted).toContain("blocked because:");
  });

  test("All conditions met → null (no block)", () => {
    const r = buildGovernanceExplanation({
      replayStatus: "AVAILABLE",
      adaptiveScore: 80,
      isLive: true,
      tradabilityHold: false,
      eventRisk: "LOW",
      calibrationStatus: "AVAILABLE"
    });
    expect(r).toBeNull();
  });
});

// ─── FACTOR WEIGHT MODEL ──────────────────────────────────────────────────────

describe("computeInstitutionalFactorWeights", () => {
  test("Total factor score between 0 and 100", () => {
    const r = computeInstitutionalFactorWeights({
      roe: 48, profitMargin: 18, debtEquity: 0.08, revenueGrowth: 10, earningsGrowth: 12,
      technicalTrend: 10, technicalMomentum: 8, volumeConfirmation: 7,
      sectorAlignment: 10, relativeStrength: 8,
      adaptiveScore: 72, replayStatus: "AVAILABLE", calibrationStatus: "AVAILABLE", driftStatus: "AVAILABLE"
    });
    expect(r.factor_breakdown.total).toBeGreaterThanOrEqual(0);
    expect(r.factor_breakdown.total).toBeLessThanOrEqual(100);
    expect(r.factor_breakdown.fundamentals).toBeDefined();
    expect(r.factor_breakdown.technicals).toBeDefined();
  });

  test("Missing replay → negative_drivers includes replay constraint", () => {
    const r = computeInstitutionalFactorWeights({
      adaptiveScore: 50,
      replayStatus: "INSUFFICIENT_REPLAY_DEPTH",
      calibrationStatus: "INSUFFICIENT_DATA",
      driftStatus: "NOT_AVAILABLE"
    });
    expect(r.negative_drivers.some(d => d.includes("Replay"))).toBe(true);
  });
});

// ─── FULL NARRATIVE — INTEGRATION ────────────────────────────────────────────

describe("buildInstitutionalFundamentalNarrative", () => {
  test("Strong fundamentals + weak adaptive → correct non-deployable narrative", () => {
    const r = buildInstitutionalFundamentalNarrative({
      rawMetrics: { roe: 48, profitMargin: 18, debtEquity: 0.08, revenueGrowth: 10, earningsGrowth: 12, pe: 25 },
      adaptiveScore: 35, // NON-DEPLOYABLE
      technicalRegime: "BEARISH",
      sector: "Information Technology"
    });
    expect(r.quality_summary.score).toBeGreaterThan(65);
    expect(r.institutional_conclusion).toContain("Fundamentals support long-term accumulation bias");
    expect(r.institutional_conclusion).not.toContain("below institutional threshold");
  });

  test("Weak fundamentals → deteriorating conclusion", () => {
    const r = buildInstitutionalFundamentalNarrative({
      rawMetrics: { roe: -8, profitMargin: -5, debtEquity: 5, revenueGrowth: -10, earningsGrowth: -20, pe: 0 },
      adaptiveScore: 25,
      technicalRegime: "BEARISH",
      sector: "Metals"
    });
    expect(r.quality_summary.score).toBeLessThan(40);
    expect(r.institutional_conclusion).toContain("below institutional threshold");
  });

  test("All output keys present", () => {
    const r = buildInstitutionalFundamentalNarrative({
      rawMetrics: {},
      adaptiveScore: 50,
      technicalRegime: "NEUTRAL",
      sector: "Unknown"
    });
    expect(r).toHaveProperty("quality_summary");
    expect(r).toHaveProperty("valuation_summary");
    expect(r).toHaveProperty("growth_summary");
    expect(r).toHaveProperty("balance_sheet_summary");
    expect(r).toHaveProperty("institutional_conclusion");
  });
});

// ─── DECISION TRACE ───────────────────────────────────────────────────────────

describe("buildDecisionTrace", () => {
  test("Non-deployable conditions → trace lists reasons", () => {
    const r = buildDecisionTrace({
      replayStatus: "INSUFFICIENT_REPLAY_DEPTH",
      adaptiveScore: 30,
      technicalTrend: "BEARISH",
      fundamentalScore: 78,
      calibrationStatus: "INSUFFICIENT_DATA",
      isLive: false,
      tradabilityHold: true
    });
    expect(r.length).toBeGreaterThan(2);
    expect(r.some(t => t.includes("Adaptive confidence"))).toBe(true);
    // Strong fundamental score should still be noted
    expect(r.some(t => t.includes("Fundamental quality remains strong"))).toBe(true);
  });

  test("All conditions met → minimal trace", () => {
    const r = buildDecisionTrace({
      replayStatus: "AVAILABLE",
      adaptiveScore: 80,
      technicalTrend: "BULLISH",
      fundamentalScore: 82,
      calibrationStatus: "AVAILABLE",
      isLive: true,
      tradabilityHold: false
    });
    expect(r.some(t => t.includes("Adaptive confidence"))).toBe(false);
    expect(r.some(t => t.includes("Fundamental quality remains strong"))).toBe(true);
  });
});
