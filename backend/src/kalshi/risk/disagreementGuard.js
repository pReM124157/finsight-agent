const DEFAULT_DISAGREEMENT_THRESHOLD = 20;
const DEFAULT_SIZE_REDUCTION_FACTOR = 0.4;
const DEFAULT_MIN_LABELED_FOR_TRUST = 30;

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function evaluateDisagreementGuard(
  { modelProbabilityYes, marketProbabilityYes, requestedSizeUsd, disagreementStats } = {},
  options = {}
) {
  const threshold = safeNumber(
    options.disagreementThreshold,
    DEFAULT_DISAGREEMENT_THRESHOLD
  );
  const reductionFactor = safeNumber(
    options.sizeReductionFactor,
    DEFAULT_SIZE_REDUCTION_FACTOR
  );
  const minLabeledForTrust = safeNumber(
    options.minLabeledForTrust,
    DEFAULT_MIN_LABELED_FOR_TRUST
  );
  const requestedSize = safeNumber(requestedSizeUsd, 0);
  const modelProbability = safeNumber(modelProbabilityYes);
  const marketProbability = safeNumber(marketProbabilityYes);

  if (modelProbability === null || marketProbability === null) {
    return {
      isHighDisagreement: false,
      disagreementPoints: null,
      adjustedSizeUsd: requestedSize,
      sizeReductionApplied: false,
      trustLevel: "UNPROVEN",
      detail: "Missing probability inputs - cannot evaluate disagreement.",
    };
  }

  const disagreementPoints = Math.abs(modelProbability - marketProbability);
  const isHighDisagreement = disagreementPoints >= threshold;

  if (!isHighDisagreement) {
    return {
      isHighDisagreement: false,
      disagreementPoints,
      adjustedSizeUsd: requestedSize,
      sizeReductionApplied: false,
      trustLevel: "UNPROVEN",
      detail: `Disagreement of ${disagreementPoints.toFixed(1)} points is below the ${threshold}-point threshold - normal sizing applies.`,
    };
  }

  const labeledCount = safeNumber(disagreementStats?.labeledCount, 0);
  const hitRate = safeNumber(disagreementStats?.hitRate);

  if (labeledCount < minLabeledForTrust) {
    const adjustedSizeUsd = Math.round(requestedSize * reductionFactor * 100) / 100;
    return {
      isHighDisagreement: true,
      disagreementPoints,
      adjustedSizeUsd,
      sizeReductionApplied: true,
      trustLevel: "UNPROVEN",
      detail: `High disagreement (${disagreementPoints.toFixed(1)} points) with only ${labeledCount}/${minLabeledForTrust} labeled outcomes on this subset so far. Sizing reduced from $${requestedSize} to $${adjustedSizeUsd} until there is enough evidence to trust the model's edge claim on large disagreements specifically.`,
    };
  }

  if (hitRate !== null && hitRate < 0.5) {
    return {
      isHighDisagreement: true,
      disagreementPoints,
      adjustedSizeUsd: 0,
      sizeReductionApplied: true,
      trustLevel: "PROVEN_BAD",
      detail: `High-disagreement subset has ${labeledCount} labeled outcomes with a ${(hitRate * 100).toFixed(1)}% hit rate - below 50%. This subset has been evaluated and the model is not reliable here. Trade size set to 0 for this category until the model is revised.`,
    };
  }

  return {
    isHighDisagreement: true,
    disagreementPoints,
    adjustedSizeUsd: requestedSize,
    sizeReductionApplied: false,
    trustLevel: "PROVEN_GOOD",
    detail: `High-disagreement subset has ${labeledCount} labeled outcomes with a ${hitRate !== null ? (hitRate * 100).toFixed(1) : "unknown"}% hit rate - evidence supports normal sizing on this category.`,
  };
}

export const disagreementGuardDefaults = {
  DEFAULT_DISAGREEMENT_THRESHOLD,
  DEFAULT_SIZE_REDUCTION_FACTOR,
  DEFAULT_MIN_LABELED_FOR_TRUST,
};
