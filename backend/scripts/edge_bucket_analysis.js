/**
 * EDGE BUCKET ANALYSIS — Stanford Builder's Calibration Test
 * 
 * Core Question: When our model says the market is mispriced by X%,
 * do we actually make more money as X increases?
 * 
 * If YES → we have a real engine.
 * If NO  → we have a lucky high-win-rate bot.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load data
const TRADES_PATH = resolve(__dirname, '../../data/kalshi-paper-trades.json');
const SNAPS_PATH  = resolve(__dirname, '../../data/kalshi-market-snapshots.json');

const allTrades    = JSON.parse(readFileSync(TRADES_PATH, 'utf-8'));
const allSnapshots = JSON.parse(readFileSync(SNAPS_PATH,  'utf-8'));

// ── 1. Filter only settled trades (won/lost, not open) ──────────────────────
const settledTrades = allTrades.filter(t => t.status === 'WON' || t.status === 'LOST');

console.log(`\n${'═'.repeat(65)}`);
console.log(`  EDGE BUCKET ANALYSIS  —  Probability OS  `);
console.log(`${'═'.repeat(65)}`);
console.log(`Total trades in file : ${allTrades.length}`);
console.log(`Settled trades       : ${settledTrades.length}`);
console.log(`Open/excluded        : ${allTrades.length - settledTrades.length}`);

// ── 2. Core metrics per trade ────────────────────────────────────────────────
const trades = settledTrades.map(t => {
  const won      = t.status === 'WON';
  const edge     = t.adjustedEdge;          // model's predicted edge %
  const rawEdge  = t.rawEdge;
  const pnl      = t.pnlUsd ?? (won ? t.maxProfitUsd : -t.maxLossUsd);
  const risked   = t.maxLossUsd ?? t.costUsd;
  const payout   = t.maxProfitUsd;
  const modelP   = t.modelProbability;
  const marketP  = t.marketProbability;
  const conf     = t.confidenceScore;
  const mins     = t.minutesRemaining;
  const side     = t.side;

  // Kelly-equivalent: actual edge / odds
  const impliedOdds = marketP > 0 ? (100 - marketP) / marketP : null;

  return {
    id: t.id,
    ticker: t.marketTicker,
    side,
    won,
    edge,
    rawEdge,
    pnl,
    risked,
    payout,
    modelP,
    marketP,
    conf,
    mins,
    roiOnRisk: risked > 0 ? (pnl / risked) * 100 : null,
    impliedOdds,
    openedAt: t.openedAt
  };
});

// ── 3. Global baseline ───────────────────────────────────────────────────────
function summarize(group, label) {
  const n         = group.length;
  if (n === 0) return null;
  const wins      = group.filter(t => t.won).length;
  const totalPnl  = group.reduce((s, t) => s + t.pnl, 0);
  const totalRisk = group.reduce((s, t) => s + t.risked, 0);
  const avgPnl    = totalPnl / n;
  const avgEdge   = group.reduce((s, t) => s + t.edge, 0) / n;
  const avgConf   = group.reduce((s, t) => s + t.conf, 0) / n;
  const avgMins   = group.reduce((s, t) => s + t.mins, 0) / n;
  const winRate   = (wins / n) * 100;
  const roi       = totalRisk > 0 ? (totalPnl / totalRisk) * 100 : 0;

  // Profit factor (gross wins / gross losses)
  const grossWin  = group.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(group.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '∞';

  // Average win / average loss
  const winners = group.filter(t => t.pnl > 0);
  const losers  = group.filter(t => t.pnl < 0);
  const avgWin  = winners.length ? winners.reduce((s,t) => s+t.pnl,0)/winners.length : 0;
  const avgLoss = losers.length  ? losers.reduce((s,t)  => s+t.pnl,0)/losers.length  : 0;

  // Max drawdown within group (peak-to-trough cumulative PnL)
  let peak = 0, trough = 0, cumPnl = 0, maxDD = 0;
  for (const t of group) {
    cumPnl += t.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }

  // Expectancy per trade
  const expectancy = (winRate/100) * avgWin + ((100-winRate)/100) * avgLoss;

  return {
    label, n, wins, winRate: winRate.toFixed(1),
    totalPnl: totalPnl.toFixed(2),
    totalRisk: totalRisk.toFixed(2),
    roi: roi.toFixed(2),
    avgPnl: avgPnl.toFixed(4),
    avgEdge: avgEdge.toFixed(1),
    avgConf: avgConf.toFixed(0),
    avgMins: avgMins.toFixed(1),
    profitFactor,
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    maxDD: maxDD.toFixed(2),
    expectancy: expectancy.toFixed(4)
  };
}

const baseline = summarize(trades, 'ALL TRADES (baseline)');

// ── 4. Edge Buckets ──────────────────────────────────────────────────────────
const BUCKETS = [
  { label: 'Bucket A: Edge  5–10%',  min: 5,  max: 10  },
  { label: 'Bucket B: Edge 10–15%',  min: 10, max: 15  },
  { label: 'Bucket C: Edge 15–20%',  min: 15, max: 20  },
  { label: 'Bucket D: Edge 20–25%',  min: 20, max: 25  },
  { label: 'Bucket E: Edge  25%+',   min: 25, max: Infinity },
];

const bucketResults = BUCKETS.map(b => {
  const group = trades.filter(t => t.edge >= b.min && t.edge < b.max);
  return summarize(group, b.label);
}).filter(Boolean);

// ── 5. Confidence Buckets ────────────────────────────────────────────────────
const CONF_BUCKETS = [
  { label: 'Conf  0–79',  min: 0,  max: 80 },
  { label: 'Conf 80–89',  min: 80, max: 90 },
  { label: 'Conf 90–99',  min: 90, max: 100},
  { label: 'Conf  100',   min: 100,max: 101},
];

const confResults = CONF_BUCKETS.map(b => {
  const group = trades.filter(t => t.conf >= b.min && t.conf < b.max);
  return summarize(group, b.label);
}).filter(r => r && r.n > 0);

// ── 6. Time Remaining Buckets ────────────────────────────────────────────────
const TIME_BUCKETS = [
  { label: 'Time ≤3 mins',    min: 0, max: 4  },
  { label: 'Time 4–6 mins',   min: 4, max: 7  },
  { label: 'Time 7–10 mins',  min: 7, max: 11 },
  { label: 'Time 11+ mins',   min: 11,max: Infinity },
];

const timeResults = TIME_BUCKETS.map(b => {
  const group = trades.filter(t => t.mins >= b.min && t.mins < b.max);
  return summarize(group, b.label);
}).filter(r => r && r.n > 0);

// ── 7. Side (YES vs NO) ──────────────────────────────────────────────────────
const yesResult = summarize(trades.filter(t => t.side === 'YES'), 'Side: YES');
const noResult  = summarize(trades.filter(t => t.side === 'NO'),  'Side: NO');

// ── 8. Calibration Check ─────────────────────────────────────────────────────
// For each trade, check if modelProbability was calibrated (i.e., did we win
// when modelP was high?)
function calibrationBuckets(tradeList) {
  const modelPBuckets = [
    { label: 'Model  0–30%', min: 0,  max: 30  },
    { label: 'Model 30–45%', min: 30, max: 45  },
    { label: 'Model 45–55%', min: 45, max: 55  },
    { label: 'Model 55–70%', min: 55, max: 70  },
    { label: 'Model  70%+',  min: 70, max: 101 },
  ];
  return modelPBuckets.map(b => {
    const group = tradeList.filter(t => t.modelP >= b.min && t.modelP < b.max);
    if (!group.length) return null;
    const wins = group.filter(t => t.won).length;
    const winRate = ((wins/group.length)*100).toFixed(1);
    const avgModelP = (group.reduce((s,t) => s+t.modelP,0)/group.length).toFixed(1);
    const roi = (group.reduce((s,t)=>s+t.pnl,0)/group.reduce((s,t)=>s+t.risked,0)*100).toFixed(2);
    return { label: b.label, n: group.length, wins, winRate, avgModelP, roi };
  }).filter(Boolean);
}

const calibration = calibrationBuckets(trades);

// ── 9. RENDER ────────────────────────────────────────────────────────────────
function printTable(headers, rows) {
  const cols = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length));
    return maxLen;
  });
  const line = cols.map(w => '─'.repeat(w + 2)).join('┼');
  const headerRow = headers.map((h, i) => h.padEnd(cols[i])).join(' │ ');
  console.log(`┌${cols.map(w=>'─'.repeat(w+2)).join('┬')}┐`);
  console.log(`│ ${headerRow} │`);
  console.log(`├${line}┤`);
  for (const row of rows) {
    const cells = row.map((c, i) => String(c ?? '').padEnd(cols[i]));
    console.log(`│ ${cells.join(' │ ')} │`);
  }
  console.log(`└${cols.map(w=>'─'.repeat(w+2)).join('┴')}┘`);
}

// Global Baseline
console.log(`\n${'─'.repeat(65)}`);
console.log('  GLOBAL BASELINE');
console.log(`${'─'.repeat(65)}`);
printTable(
  ['Metric', 'Value'],
  [
    ['Trades',          baseline.n],
    ['Win Rate',        `${baseline.winRate}%`],
    ['Total PnL',       `$${baseline.totalPnl}`],
    ['Total Risked',    `$${baseline.totalRisk}`],
    ['ROI on Risk',     `${baseline.roi}%`],
    ['Avg PnL/trade',   `$${baseline.avgPnl}`],
    ['Avg Win',         `$${baseline.avgWin}`],
    ['Avg Loss',        `$${baseline.avgLoss}`],
    ['Profit Factor',   baseline.profitFactor],
    ['Expectancy',      `$${baseline.expectancy}`],
    ['Max Drawdown',    `$${baseline.maxDD}`],
    ['Avg Edge',        `${baseline.avgEdge}%`],
    ['Avg Confidence',  `${baseline.avgConf}`],
    ['Avg Mins Left',   baseline.avgMins],
  ]
);

// Edge Buckets — THE KEY TEST
console.log(`\n${'─'.repeat(65)}`);
console.log('  ★ EDGE BUCKET ANALYSIS  (Does higher edge = higher ROI?)');
console.log(`${'─'.repeat(65)}`);
printTable(
  ['Bucket', 'N', 'WinRate', 'ROI%', 'AvgPnL', 'ProfitF', 'AvgWin', 'AvgLoss', 'MaxDD'],
  bucketResults.map(b => [
    b.label, b.n, `${b.winRate}%`, `${b.roi}%`,
    `$${b.avgPnl}`, b.profitFactor,
    `$${b.avgWin}`, `$${b.avgLoss}`, `$${b.maxDD}`
  ])
);

// Verdict
console.log('\n  ⚡ VERDICT:');
const roiValues = bucketResults.map(b => parseFloat(b.roi));
let monotonic = true;
for (let i = 1; i < roiValues.length; i++) {
  if (roiValues[i] < roiValues[i-1]) { monotonic = false; break; }
}
if (monotonic && roiValues.length > 1) {
  console.log('  ✅ ROI increases monotonically with edge. Model has REAL edge signal.');
} else {
  // Check if high edge buckets outperform overall
  const highEdge = bucketResults.filter(b => b.label.includes('25%+') || b.label.includes('20–25'));
  const highEdgeRoi = highEdge.map(b => parseFloat(b.roi));
  const baselineRoi = parseFloat(baseline.roi);
  if (highEdgeRoi.some(r => r > baselineRoi)) {
    console.log('  ⚠️  ROI is not strictly monotonic but high-edge buckets outperform baseline.');
    console.log('     Partial edge signal — needs more data to confirm.');
  } else {
    console.log('  ❌ ROI is NOT correlated with edge. Model edge metric may be miscalibrated.');
    console.log('     High win rate may be hiding a thin or random edge.');
  }
}

// Confidence Buckets
console.log(`\n${'─'.repeat(65)}`);
console.log('  CONFIDENCE SCORE BUCKETS');
console.log(`${'─'.repeat(65)}`);
printTable(
  ['Bucket', 'N', 'WinRate', 'ROI%', 'AvgPnL', 'ProfitF'],
  confResults.map(b => [
    b.label, b.n, `${b.winRate}%`, `${b.roi}%`, `$${b.avgPnl}`, b.profitFactor
  ])
);

// Time Buckets
console.log(`\n${'─'.repeat(65)}`);
console.log('  TIME-TO-EXPIRY BUCKETS');
console.log(`${'─'.repeat(65)}`);
printTable(
  ['Bucket', 'N', 'WinRate', 'ROI%', 'AvgPnL', 'ProfitF'],
  timeResults.map(b => [
    b.label, b.n, `${b.winRate}%`, `${b.roi}%`, `$${b.avgPnl}`, b.profitFactor
  ])
);

// Side Analysis
console.log(`\n${'─'.repeat(65)}`);
console.log('  YES vs NO SIDE ANALYSIS');
console.log(`${'─'.repeat(65)}`);
printTable(
  ['Side', 'N', 'WinRate', 'ROI%', 'AvgPnL', 'ProfitF'],
  [yesResult, noResult].filter(Boolean).map(b => [
    b.label, b.n, `${b.winRate}%`, `${b.roi}%`, `$${b.avgPnl}`, b.profitFactor
  ])
);

// Calibration
console.log(`\n${'─'.repeat(65)}`);
console.log('  MODEL CALIBRATION (Did win rate match model probability?)');
console.log(`${'─'.repeat(65)}`);
printTable(
  ['Model P Range', 'N', 'AvgModelP', 'ActualWinRate', 'ROI%'],
  calibration.map(b => [
    b.label, b.n, `${b.avgModelP}%`, `${b.winRate}%`, `${b.roi}%`
  ])
);

// Individual trade breakdown
console.log(`\n${'─'.repeat(65)}`);
console.log('  INDIVIDUAL TRADE LOG (sorted by edge descending)');
console.log(`${'─'.repeat(65)}`);
const sorted = [...trades].sort((a, b) => b.edge - a.edge);
printTable(
  ['#', 'Edge%', 'ModelP%', 'MarketP%', 'Conf', 'Mins', 'Side', 'Won', 'PnL', 'ROI%'],
  sorted.map((t, i) => [
    i+1,
    t.edge.toFixed(1),
    t.modelP.toFixed(1),
    t.marketP.toFixed(1),
    t.conf,
    t.mins,
    t.side,
    t.won ? '✓' : '✗',
    `$${t.pnl.toFixed(2)}`,
    `${t.roiOnRisk.toFixed(0)}%`
  ])
);

// Summary Diagnosis
console.log(`\n${'═'.repeat(65)}`);
console.log('  STANFORD BUILDER DIAGNOSIS');
console.log(`${'═'.repeat(65)}`);

const highEdgeTrades = trades.filter(t => t.edge >= 20);
const lowEdgeTrades  = trades.filter(t => t.edge < 15);

const highEdgeWR  = highEdgeTrades.length ? (highEdgeTrades.filter(t=>t.won).length/highEdgeTrades.length*100).toFixed(1) : 'N/A';
const lowEdgeWR   = lowEdgeTrades.length  ? (lowEdgeTrades.filter(t=>t.won).length/lowEdgeTrades.length*100).toFixed(1) : 'N/A';
const highEdgeROI = highEdgeTrades.length 
  ? (highEdgeTrades.reduce((s,t)=>s+t.pnl,0)/highEdgeTrades.reduce((s,t)=>s+t.risked,0)*100).toFixed(2)
  : 'N/A';
const lowEdgeROI  = lowEdgeTrades.length  
  ? (lowEdgeTrades.reduce((s,t)=>s+t.pnl,0)/lowEdgeTrades.reduce((s,t)=>s+t.risked,0)*100).toFixed(2)
  : 'N/A';

console.log(`\n  High Edge (≥20%)  : ${highEdgeTrades.length} trades | WinRate ${highEdgeWR}% | ROI ${highEdgeROI}%`);
console.log(`  Low Edge  (<15%)  : ${lowEdgeTrades.length} trades | WinRate ${lowEdgeWR}%  | ROI ${lowEdgeROI}%`);
console.log(`\n  Profit Factor     : ${baseline.profitFactor} (>1.5 = good, >2.0 = strong)`);
console.log(`  Expectancy/Trade  : $${baseline.expectancy}`);
console.log(`  Avg Win / Avg Loss: $${baseline.avgWin} / $${baseline.avgLoss}`);
console.log(`\n  NEXT RECOMMENDED THRESHOLD:`);

// Find best bucket
const bestBucket = [...bucketResults].sort((a,b) => parseFloat(b.roi)-parseFloat(a.roi))[0];
if (bestBucket) {
  console.log(`  → Best ROI bucket is: ${bestBucket.label}`);
  console.log(`    ROI: ${bestBucket.roi}% | WinRate: ${bestBucket.winRate}% | Trades: ${bestBucket.n}`);
  console.log(`    Recommendation: Only trade when adjustedEdge falls in this range or higher.`);
}

console.log(`\n${'═'.repeat(65)}\n`);
