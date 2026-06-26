function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value, digits = 2) {
  const n = safeNumber(value);
  return n === null ? null : Number(n.toFixed(digits));
}

function formatUsd(value, digits = 0) {
  const n = safeNumber(value);
  if (n === null) return "N/A";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatPercent(value, digits = 1) {
  const n = safeNumber(value);
  return n === null ? "N/A" : `${n.toFixed(digits)}%`;
}

function formatCents(value) {
  const n = safeNumber(value);
  return n === null ? "N/A" : `${Number(n.toFixed(2)).toString()}c`;
}

function formatBps(value, digits = 1) {
  const n = safeNumber(value);
  return n === null ? "N/A" : `${n.toFixed(digits)} bps`;
}

function getSidePricing(side, mispricing) {
  if (side === "YES") {
    return {
      entryPriceCents: safeNumber(mispricing?.yes?.ask),
      spreadCents: safeNumber(mispricing?.yes?.spread),
    };
  }

  if (side === "NO") {
    return {
      entryPriceCents: safeNumber(mispricing?.no?.ask),
      spreadCents: safeNumber(mispricing?.no?.spread),
    };
  }

  return {
    entryPriceCents: null,
    spreadCents: null,
  };
}

function getMaxEntryPriceCents(side, modelProbability) {
  const modelProb = safeNumber(modelProbability);
  if (!side || modelProb === null) return null;

  const rawMax =
    side === "YES"
      ? Math.floor(modelProb - 5)
      : Math.floor((100 - modelProb) - 5);

  return clamp(rawMax, 1, 99);
}

function getSuggestedPaperSizeUsd({ paperTrade, risk, mispricing }) {
  const fromTrade = safeNumber(paperTrade?.trade?.sizeUsd);
  if (fromTrade !== null) return fromTrade;

  const fromRisk = safeNumber(risk?.checks?.find((check) => check.code === "TRADE_SIZE_OK")?.tradeSize);
  if (fromRisk !== null) return fromRisk;

  const adjustedEdge = safeNumber(mispricing?.bestAdjustedEdge, 0);
  if (adjustedEdge >= 25) return 500;
  if (adjustedEdge >= 20) return 250;
  if (adjustedEdge >= 15) return 100;
  if (adjustedEdge >= 10) return 50;
  if (adjustedEdge >= 5) return 25;
  return null;
}

function buildReasoningBullets({
  side,
  btc,
  reachability,
  distanceGuard,
  mispricing,
  risk,
  targetPrice,
  minutesRemaining,
  entryPriceCents,
  maxEntryPriceCents,
}) {
  const currentBtcPrice =
    safeNumber(btc?.price) ??
    safeNumber(reachability?.currentPrice);
  const finalTargetPrice =
    safeNumber(targetPrice) ??
    safeNumber(reachability?.targetPrice);
  const distanceBps = safeNumber(reachability?.distanceBps);
  const modelProbability =
    safeNumber(reachability?.modelProbability) ??
    safeNumber(mispricing?.modelProbability);
  const marketProbability = safeNumber(mispricing?.marketProbability);
  const adjustedEdge = safeNumber(mispricing?.bestAdjustedEdge);
  const riskStatus = risk?.status || "NOT_RUN";
  const guardedDistanceBps =
    safeNumber(distanceGuard?.distanceBps) ??
    safeNumber(reachability?.distanceBps);
  const guardedDistanceUsd =
    safeNumber(distanceGuard?.distanceUsd);

  const bullets = [];

  bullets.push(
    `BTC is ${formatUsd(currentBtcPrice, 2)} versus a ${formatUsd(finalTargetPrice, 0)} target over ${minutesRemaining || reachability?.minutesRemaining || "N/A"} minutes.`
  );

  bullets.push(
    `The move required is ${formatBps(guardedDistanceBps)}${guardedDistanceUsd !== null ? ` (${formatUsd(guardedDistanceUsd, 2)})` : ""} and the model estimates ${formatPercent(modelProbability)} odds versus a market price of ${formatPercent(marketProbability)}.`
  );

  bullets.push(
    `${side ? `${side} ` : ""}adjusted edge is ${formatPercent(adjustedEdge)} with entry around ${formatCents(entryPriceCents)} and a max paper entry near ${formatCents(maxEntryPriceCents)}.`
  );

  bullets.push(
    `Risk status is ${riskStatus}. This guidance is for paper trading only and should be skipped if the quote or risk state changes.`
  );

  return bullets;
}

function buildInvalidationRules({
  side,
  maxEntryPriceCents,
  mispricing,
  risk,
}) {
  const sideLabel = side || "selected side";
  const rules = [];

  if (maxEntryPriceCents !== null) {
    rules.push(
      `Skip if ${sideLabel} ask moves above ${maxEntryPriceCents}c.`
    );
  } else {
    rules.push(`Skip if ${sideLabel} pricing becomes unavailable.`);
  }

  const maxSpread = safeNumber(mispricing?.maxAllowedSpreadPct);
  if (maxSpread !== null) {
    rules.push(`Skip if spread widens above ${maxSpread}c.`);
  } else {
    rules.push("Skip if spread widens above risk threshold.");
  }

  if (risk?.status === "REJECTED") {
    const firstFailed = risk?.failedChecks?.[0];
    rules.push(
      `Risk gate rejected the trade${firstFailed?.message ? `: ${firstFailed.message}` : "."}`
    );
  } else {
    rules.push("Skip if risk gate rejects the trade.");
  }

  return rules;
}

function buildHumanMessage({
  headline,
  marketTicker,
  side,
  currentBtcPrice,
  targetPrice,
  minutesRemaining,
  entryPriceCents,
  maxEntryPriceCents,
  modelProbability,
  marketProbability,
  adjustedEdge,
  riskStatus,
  suggestedPaperSizeUsd,
  reasoningBullets,
  action,
}) {
  const marketDirection = side === "NO" ? "below" : "above";
  const marketLine =
    targetPrice !== null && minutesRemaining !== null
      ? `Market: BTC ${marketDirection} ${formatUsd(targetPrice, 0)} in ${minutesRemaining} minutes`
      : marketTicker
        ? `Market: ${marketTicker}`
        : "Market: BTC paper setup";

  const reasonText = reasoningBullets.slice(0, 3).join(" ");

  const lines = [
    headline,
    marketLine,
  ];

  if (marketTicker) {
    lines.push(`Ticker: ${marketTicker}`);
  }

  lines.push(
    `Current BTC: ${formatUsd(currentBtcPrice, 2)}`,
    `Entry: ${side ? `${side} at ${formatCents(entryPriceCents)}` : "Wait for clearer pricing"}`,
    `Max entry: ${formatCents(maxEntryPriceCents)}`,
    `Model probability: ${formatPercent(modelProbability)}`,
    `Market probability: ${formatPercent(marketProbability)}`,
    `Edge: ${formatPercent(adjustedEdge)}`,
    `Risk: ${riskStatus}`,
    `Suggested paper size: ${suggestedPaperSizeUsd === null ? "N/A" : formatUsd(suggestedPaperSizeUsd, 0)}`,
    `Reason: ${reasonText}`,
    `Action: ${action}${maxEntryPriceCents !== null ? ` only below ${formatCents(maxEntryPriceCents)}.` : "."}`,
  );

  return lines.join("\n");
}

export function buildHumanSignalExplanation({
  btc,
  reachability,
  distanceGuard,
  mispricing,
  risk,
  paperTrade,
  marketTicker,
  targetPrice,
  minutesRemaining,
  stage = null,
  reason = null,
  action = null,
  ok = true,
} = {}) {
  const trade = paperTrade?.trade || null;
  const side = trade?.side || mispricing?.bestSide || null;
  const currentBtcPrice =
    safeNumber(btc?.price) ??
    safeNumber(reachability?.currentPrice) ??
    safeNumber(trade?.btcPrice);
  const finalTargetPrice =
    safeNumber(targetPrice) ??
    safeNumber(trade?.targetPrice) ??
    safeNumber(reachability?.targetPrice);
  const finalMinutesRemaining =
    safeNumber(minutesRemaining) ??
    safeNumber(trade?.minutesRemaining) ??
    safeNumber(reachability?.minutesRemaining);
  const modelProbability =
    safeNumber(reachability?.modelProbability) ??
    safeNumber(mispricing?.modelProbability) ??
    safeNumber(trade?.modelProbability);
  const marketProbability =
    safeNumber(mispricing?.marketProbability) ??
    safeNumber(trade?.marketProbability);
  const adjustedEdge =
    safeNumber(mispricing?.bestAdjustedEdge) ??
    safeNumber(trade?.adjustedEdge);
  const confidenceScore =
    safeNumber(mispricing?.confidenceScore) ??
    safeNumber(trade?.confidenceScore);
  const riskStatus = risk?.status || "NOT_RUN";
  const { entryPriceCents, spreadCents } = getSidePricing(side, mispricing);
  const maxEntryPriceCents = getMaxEntryPriceCents(side, modelProbability);
  const suggestedPaperSizeUsd = getSuggestedPaperSizeUsd({
    paperTrade,
    risk,
    mispricing,
  });

  let signalType = "SKIP";
  let headline = "PAPER SIGNAL: SKIP";
  let actionText = "Skip paper trade";
  let finalSide = side;

  if (!ok || stage && !["DECISION", "RISK", "PAPER_TRADE_CREATED"].includes(stage)) {
    signalType = "ERROR";
    headline = "PAPER SIGNAL: ERROR";
    actionText = "Do not place a paper trade";
  } else if (risk?.status === "REJECTED") {
    signalType = "RISK_REJECTED";
    headline = "PAPER SIGNAL: RISK REJECTED";
    actionText = "Skip paper trade due to risk gate";
  } else if (distanceGuard?.status === "WATCH_ONLY") {
    signalType = "WATCH";
    headline = "PAPER SIGNAL: WATCH";
    actionText = "Watch only until the target distance comes closer";
  } else if (distanceGuard?.status === "REJECTED") {
    signalType = "SKIP";
    headline = "PAPER SIGNAL: SKIP";
    actionText = "Skip paper trade because the target is too far";
  } else if (mispricing?.decision === "WATCH") {
    signalType = "WATCH";
    headline = `PAPER SIGNAL: WATCH ${side || ""}`.trim();
    actionText = `Watch ${side || "market"} for a better paper entry`;
  } else if (mispricing?.decision === "NO_TRADE") {
    signalType = "SKIP";
    headline = "PAPER SIGNAL: SKIP";
    actionText = "Skip paper trade";
  } else if (mispricing?.decision === "TRADE" && side) {
    signalType = side === "YES" ? "BUY_YES" : "BUY_NO";
    headline = `PAPER SIGNAL: BUY ${side}`;
    actionText = `Paper BUY ${side}`;
  } else if (action === "NO_PAPER_TRADE") {
    signalType = "SKIP";
    headline = "PAPER SIGNAL: SKIP";
    actionText = "Skip paper trade";
  }

  if (
    signalType.startsWith("BUY_") &&
    entryPriceCents !== null &&
    maxEntryPriceCents !== null &&
    entryPriceCents > maxEntryPriceCents
  ) {
    signalType = "WATCH";
    headline = `PAPER SIGNAL: WATCH ${side}`;
    actionText = `Wait for ${side} to return below ${formatCents(maxEntryPriceCents)}`;
  }

  const reasoningBullets = buildReasoningBullets({
    side: finalSide,
    btc,
    reachability,
    distanceGuard,
    mispricing,
    risk,
    targetPrice: finalTargetPrice,
    minutesRemaining: finalMinutesRemaining,
    entryPriceCents,
    maxEntryPriceCents,
  });

  if (signalType === "WATCH" && mispricing?.decision === "WATCH" && maxEntryPriceCents !== null) {
    reasoningBullets.push(
      `This is a watchlist setup because the edge is not yet strong enough; a better entry would usually mean ${side} at or below ${formatCents(maxEntryPriceCents)} with stronger adjusted edge.`
    );
  }

  if (distanceGuard?.status === "WATCH_ONLY") {
    reasoningBullets.push(
      distanceGuard.explanation || "The target is a bit too far for this time window, so the setup is watch-only for now."
    );
  }

  if (signalType === "SKIP") {
    if (distanceGuard?.status === "REJECTED") {
      reasoningBullets.push(
        distanceGuard.explanation || "The target is too far for this time window, so the trade is being skipped."
      );
    } else if (mispricing?.edgeGrade === "SPREAD_TOO_WIDE") {
      reasoningBullets.push("The market is being skipped because the spread is too wide for the configured threshold.");
    } else {
      reasoningBullets.push("The market is being skipped because the expected edge is not strong enough after costs.");
    }
  }

  if (signalType === "RISK_REJECTED") {
    const firstFailed = risk?.failedChecks?.[0];
    reasoningBullets.push(
      `Risk rejected the setup${firstFailed?.message ? `: ${firstFailed.message}` : reason ? `: ${reason}` : "."}`
    );
  }

  if (signalType === "ERROR") {
    reasoningBullets.push(
      `The decision flow failed at ${stage || "UNKNOWN_STAGE"}${reason ? ` with ${reason}.` : "."}`
    );
  }

  const invalidationRules = buildInvalidationRules({
    side: finalSide,
    maxEntryPriceCents,
    mispricing,
    risk,
  });

  const humanMessage = buildHumanMessage({
    headline,
    marketTicker,
    side: finalSide,
    currentBtcPrice,
    targetPrice: finalTargetPrice,
    minutesRemaining: finalMinutesRemaining,
    entryPriceCents,
    maxEntryPriceCents,
    modelProbability,
    marketProbability,
    adjustedEdge,
    riskStatus,
    suggestedPaperSizeUsd,
    reasoningBullets,
    action: actionText,
  });

  return {
    ok: signalType !== "ERROR",
    signalType,
    headline,
    action: actionText,
    side: finalSide,
    marketTicker: marketTicker || trade?.marketTicker || null,
    currentBtcPrice: roundNumber(currentBtcPrice),
    targetPrice: roundNumber(finalTargetPrice),
    minutesRemaining: safeNumber(finalMinutesRemaining),
    entryPriceCents: roundNumber(entryPriceCents),
    maxEntryPriceCents: roundNumber(maxEntryPriceCents),
    modelProbability: roundNumber(modelProbability, 1),
    marketProbability: roundNumber(marketProbability, 1),
    adjustedEdge: roundNumber(adjustedEdge, 1),
    riskStatus,
    suggestedPaperSizeUsd: roundNumber(suggestedPaperSizeUsd),
    confidenceScore: roundNumber(confidenceScore),
    spreadCents: roundNumber(spreadCents),
    distanceGuard: distanceGuard || null,
    reasoningBullets,
    invalidationRules,
    reason: reason || null,
    humanMessage,
  };
}

export function buildSignalFromDecisionFlowResult(result) {
  if (!result || typeof result !== "object") {
    return buildHumanSignalExplanation({
      ok: false,
      stage: "INPUT_VALIDATION",
      reason: "MISSING_DECISION_RESULT",
    });
  }

  const marketTicker =
    result.paperTrade?.trade?.marketTicker ||
    result.marketTicker ||
    null;
  const targetPrice =
    safeNumber(result.paperTrade?.trade?.targetPrice) ??
    safeNumber(result.reachability?.targetPrice) ??
    safeNumber(result.targetPrice);
  const minutesRemaining =
    safeNumber(result.paperTrade?.trade?.minutesRemaining) ??
    safeNumber(result.reachability?.minutesRemaining) ??
    safeNumber(result.minutesRemaining);

  return buildHumanSignalExplanation({
    ok: Boolean(result.ok),
    stage: result.stage || null,
    reason: result.reason || null,
    action: result.action || null,
    btc: result.btc,
    reachability: result.reachability,
    distanceGuard: result.distanceGuard,
    mispricing: result.mispricing,
    risk: result.risk,
    paperTrade: result.paperTrade,
    marketTicker,
    targetPrice,
    minutesRemaining,
  });
}
