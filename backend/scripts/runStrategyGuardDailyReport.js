import {
  generateAndSaveStrategyGuardDailyReport,
  STRATEGY_GUARD_REASONS,
} from "../src/kalshi/reporting/strategyGuardDailyReport.js";

function parseArgs(argv = []) {
  const args = {};

  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.slice(2).split("=");
    args[key] = value ?? "true";
  }

  return args;
}

function printLine(label, value) {
  console.log(`${label}: ${value}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = generateAndSaveStrategyGuardDailyReport({
    date: args.date || new Date().toISOString().slice(0, 10),
    sessionId: args.sessionId || process.env.KALSHI_ACTIVE_SESSION_ID || null,
  });

  const { report } = result;

  console.log("STRATEGY GUARD DAILY REPORT");
  printLine("Date", report.date);
  printLine("Session", report.sessionId || "UNKNOWN");
  console.log("Accepted:");
  printLine("Trades", report.accepted.trades);
  printLine("Settled", report.accepted.settledTrades);
  printLine("Wins/Losses", `${report.accepted.wins}/${report.accepted.losses}`);
  printLine("PnL", `$${report.accepted.pnlUsd}`);
  printLine("ROI", `${report.accepted.roiPct}%`);
  printLine("Max Drawdown", `$${report.accepted.maxDrawdownUsd}`);
  console.log("Rejected:");
  printLine("Total", report.rejected.totalRejected);
  console.log("By reason:");
  for (const reason of STRATEGY_GUARD_REASONS) {
    console.log(`- ${reason}: ${report.rejected.byReason[reason] || 0}`);
  }
  console.log("Rejected Outcome Audit:");
  printLine("Settled rejected candidates", report.rejectedOutcomeAudit.settledRejectedCandidates);
  printLine("Would have won", report.rejectedOutcomeAudit.wouldHaveWon);
  printLine("Would have lost", report.rejectedOutcomeAudit.wouldHaveLost);
  printLine("Hypothetical PnL", `$${report.rejectedOutcomeAudit.hypotheticalPnlUsd}`);
  printLine("Hypothetical ROI", `${report.rejectedOutcomeAudit.hypotheticalRoiPct}%`);
  printLine("Guard Verdict", report.verdict);

  if (report.notes.length > 0) {
    console.log("Notes:");
    for (const note of report.notes) {
      console.log(`- ${note}`);
    }
  }
}

main();
