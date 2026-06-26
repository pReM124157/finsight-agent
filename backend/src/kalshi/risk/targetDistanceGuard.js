function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function evaluateTargetDistanceGuard({
  currentPrice,
  targetPrice,
  minutesRemaining = 15,
  maxDistanceBps = 25,
  maxDistanceUsd = 150,
  hardRejectDistanceBps = 40,
  hardRejectDistanceUsd = 250,
} = {}) {
  const current = safeNumber(currentPrice);
  const target = safeNumber(targetPrice);
  const minutes = safeNumber(minutesRemaining, 15);

  if (!current || !target || current <= 0 || target <= 0) {
    return {
      approved: false,
      status: "REJECTED",
      reason: "INVALID_DISTANCE_INPUT",
    };
  }

  const distanceUsd = Math.abs(target - current);
  const distanceBps = (distanceUsd / current) * 10000;

  const normalizedMinutes = Math.max(1, minutes);
  const timeScale = Math.sqrt(normalizedMinutes / 15);

  const scaledMaxDistanceUsd = maxDistanceUsd * timeScale;
  const scaledMaxDistanceBps = maxDistanceBps * timeScale;
  const scaledHardRejectUsd = hardRejectDistanceUsd * timeScale;
  const scaledHardRejectBps = hardRejectDistanceBps * timeScale;

  if (
    distanceUsd >= scaledHardRejectUsd ||
    distanceBps >= scaledHardRejectBps
  ) {
    return {
      approved: false,
      status: "REJECTED",
      reason: "TARGET_TOO_FAR_HARD_REJECT",
      distanceUsd: Number(distanceUsd.toFixed(2)),
      distanceBps: Number(distanceBps.toFixed(2)),
      maxAllowedDistanceUsd: Number(scaledMaxDistanceUsd.toFixed(2)),
      maxAllowedDistanceBps: Number(scaledMaxDistanceBps.toFixed(2)),
      hardRejectDistanceUsd: Number(scaledHardRejectUsd.toFixed(2)),
      hardRejectDistanceBps: Number(scaledHardRejectBps.toFixed(2)),
      explanation:
        `Target is too far away. BTC must move $${distanceUsd.toFixed(2)} ` +
        `(${distanceBps.toFixed(2)} bps) in ${minutes} minutes.`,
    };
  }

  if (
    distanceUsd > scaledMaxDistanceUsd ||
    distanceBps > scaledMaxDistanceBps
  ) {
    return {
      approved: false,
      status: "WATCH_ONLY",
      reason: "TARGET_TOO_FAR_WATCH_ONLY",
      distanceUsd: Number(distanceUsd.toFixed(2)),
      distanceBps: Number(distanceBps.toFixed(2)),
      maxAllowedDistanceUsd: Number(scaledMaxDistanceUsd.toFixed(2)),
      maxAllowedDistanceBps: Number(scaledMaxDistanceBps.toFixed(2)),
      hardRejectDistanceUsd: Number(scaledHardRejectUsd.toFixed(2)),
      hardRejectDistanceBps: Number(scaledHardRejectBps.toFixed(2)),
      explanation:
        `Target is far for the time window. BTC must move $${distanceUsd.toFixed(2)} ` +
        `(${distanceBps.toFixed(2)} bps) in ${minutes} minutes. Downgrade to WATCH.`,
    };
  }

  return {
    approved: true,
    status: "APPROVED",
    reason: "TARGET_DISTANCE_OK",
    distanceUsd: Number(distanceUsd.toFixed(2)),
    distanceBps: Number(distanceBps.toFixed(2)),
    maxAllowedDistanceUsd: Number(scaledMaxDistanceUsd.toFixed(2)),
    maxAllowedDistanceBps: Number(scaledMaxDistanceBps.toFixed(2)),
    hardRejectDistanceUsd: Number(scaledHardRejectUsd.toFixed(2)),
    hardRejectDistanceBps: Number(scaledHardRejectBps.toFixed(2)),
    explanation:
      `Target distance is acceptable. BTC must move $${distanceUsd.toFixed(2)} ` +
      `(${distanceBps.toFixed(2)} bps) in ${minutes} minutes.`,
  };
}
