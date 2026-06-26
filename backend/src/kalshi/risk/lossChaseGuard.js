/**
 * Block re-entry into the same market window after an open or losing trade.
 */
export function checkLossChaseGuard(marketTicker, recentTrades = [], options = {}) {
  const cooldownWindowMs = options.cooldownWindowMs ?? 20 * 60 * 1000;
  const now = Date.now();

  if (!marketTicker) {
    return { approved: true };
  }

  const sameMarketTrades = (recentTrades || [])
    .filter((trade) => trade && trade.marketTicker === marketTicker)
    .filter((trade) => {
      const closedAtTs = trade.closedAt ? new Date(trade.closedAt).getTime() : null;
      if (closedAtTs === null || !Number.isFinite(closedAtTs)) {
        return true;
      }
      return now - closedAtTs <= cooldownWindowMs;
    })
    .sort((a, b) => {
      const aTs = a.closedAt ? new Date(a.closedAt).getTime() : now;
      const bTs = b.closedAt ? new Date(b.closedAt).getTime() : now;
      return bTs - aTs;
    });

  if (sameMarketTrades.length === 0) {
    return { approved: true };
  }

  const mostRecent = sameMarketTrades[0];
  const isLoss =
    mostRecent.status === "LOST" ||
    mostRecent.status === "STOP_HIT" ||
    (typeof mostRecent.pnlUsd === "number" && mostRecent.pnlUsd < 0);
  const isStillOpen =
    mostRecent.status === "OPEN" || mostRecent.closedAt == null;

  if (isStillOpen) {
    return {
      approved: false,
      reason: "POSITION_ALREADY_OPEN_THIS_MARKET",
      detail:
        `An open position already exists for ${marketTicker}. Adding another position in the same window before this one resolves increases exposure without new information.`,
      priorTrade: mostRecent,
    };
  }

  if (isLoss) {
    return {
      approved: false,
      reason: "LOSS_CHASE_BLOCKED",
      detail:
        `Blocked re-entry into ${marketTicker} after a losing position in the same window. This window's outcome does not depend on the prior trade's result; re-entering here is loss-chasing, not a new independent decision.`,
      priorTrade: mostRecent,
    };
  }

  return { approved: true };
}

export const _internal = {};
