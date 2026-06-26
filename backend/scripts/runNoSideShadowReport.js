import { generateAndSaveNoSideShadowReport } from "../src/kalshi/reporting/noSideShadowReport.js";

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
  const result = generateAndSaveNoSideShadowReport({
    date: args.date || null,
  });

  if (!result.ok) {
    console.log("NO-SIDE SHADOW PERFORMANCE REPORT");
    printLine("Status", "FAILED");
    printLine("Reason", result.reason || "UNKNOWN");
    printLine("Rows", result.totalRows || 0);
    process.exit(1);
  }

  const report = result.report || result;

  console.log("NO-SIDE SHADOW PERFORMANCE REPORT");
  printLine("Generated", report.generatedAt);
  printLine("Rows", report.summary.totalRows);
  printLine("Candidates", report.summary.candidateRows);
  printLine("Rejected", report.summary.rejectedRows);
  printLine("Settled candidates", report.summary.settledCandidates);
  printLine("Executable settled candidates", report.summary.executableSettledCandidates);
  console.log("Candidate performance:");
  printLine("Trades", report.candidatePerformance.trades);
  printLine("Wins/Losses", `${report.candidatePerformance.wins}/${report.candidatePerformance.losses}`);
  printLine("Win rate", `${report.candidatePerformance.winRate}%`);
  printLine("P&L", `$${report.candidatePerformance.totalPnlUsd}`);
  printLine("ROI", `${report.candidatePerformance.roiPct}%`);
  printLine("Profit factor", report.candidatePerformance.profitFactor ?? "N/A");
  printLine("Max drawdown", `$${report.candidatePerformance.maxDrawdownUsd}`);
  console.log("Rejected audit:");
  printLine("Rejected", report.rejectedAudit.totalRejected);
  printLine("Settled rejected", report.rejectedAudit.settledRejected);
  printLine(
    "Would have won/lost",
    `${report.rejectedAudit.rejectedWouldHaveWon}/${report.rejectedAudit.rejectedWouldHaveLost}`
  );
  printLine("Hypothetical P&L", `$${report.rejectedAudit.rejectedHypotheticalPnlUsd}`);
  printLine("Hypothetical ROI", `${report.rejectedAudit.rejectedHypotheticalRoiPct}%`);
  console.log("Best zones:");
  for (const zone of report.bestZones.slice(0, 5)) {
    console.log(`- ${zone.band}: ROI ${zone.roiPct}%, PnL $${zone.totalPnlUsd}, executable ${zone.executable}`);
  }
  console.log("Worst zones:");
  for (const zone of report.worstZones.slice(0, 5)) {
    console.log(`- ${zone.band}: ROI ${zone.roiPct}%, PnL $${zone.totalPnlUsd}, executable ${zone.executable}`);
  }
  printLine("Verdict", report.verdict);
  printLine("Recommendation", report.recommendation);
}

main();
