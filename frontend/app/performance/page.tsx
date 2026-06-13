"use client";

import dynamic from "next/dynamic";
import { motion, type Variants } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { LoadingPulse } from "@/components/ui/LoadingPulse";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatNumber } from "@/lib/utils";

const PerformanceChart = dynamic(
  () =>
    import("@/components/charts/PerformanceChart").then(
      (module) => module.PerformanceChart
    ),
  {
    ssr: false,
    loading: () => <LoadingPulse lines={8} />,
  }
);

const WinRateChart = dynamic(
  () =>
    import("@/components/charts/WinRateChart").then(
      (module) => module.WinRateChart
    ),
  {
    ssr: false,
    loading: () => <LoadingPulse lines={8} />,
  }
);

const easeOut = [0, 0, 0.2, 1] as const;

const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOut } },
};

const performanceData = [
  { date: "Jun 05", recommendations: 48 },
  { date: "Jun 06", recommendations: 71 },
  { date: "Jun 07", recommendations: 93 },
  { date: "Jun 08", recommendations: 118 },
  { date: "Jun 09", recommendations: 132 },
  { date: "Jun 10", recommendations: 149 },
  { date: "Jun 11", recommendations: 161 },
];

const strategies = [
  { strategy: "Momentum Continuation", count: 28, winRate: 31.4, avgReturn: 0.42 },
  { strategy: "Mean Reversion", count: 24, winRate: 22.8, avgReturn: -0.66 },
  { strategy: "Breakout Watch", count: 22, winRate: 26.1, avgReturn: -0.21 },
  { strategy: "Risk-Off Hold", count: 19, winRate: 18.5, avgReturn: -1.14 },
  { strategy: "Accumulation Bias", count: 18, winRate: 29.2, avgReturn: 0.11 },
  { strategy: "Sector Rotation", count: 16, winRate: 24.6, avgReturn: -0.58 },
  { strategy: "Valuation Support", count: 14, winRate: 21.3, avgReturn: -0.93 },
  { strategy: "Event Risk Avoidance", count: 11, winRate: 15.9, avgReturn: -1.72 },
  { strategy: "Defensive Quality", count: 9, winRate: 27.7, avgReturn: -0.34 },
];

export default function PerformancePage() {
  const total = 161;
  const closed = 34;
  const open = 127;
  const targetHit = 8;
  const stopHit = 26;

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <section className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Statistical Validation
          </p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-[var(--text-primary)] md:text-6xl">
            Performance <span className="gradient-text">Dashboard</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--text-secondary)]">
            Track recommendation quality, closed outcomes, calibration drift, and
            strategy-level behavior with honest institutional reporting.
          </p>
        </div>

        <Badge tone="purple">Model Under Calibration</Badge>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Win Rate"
          value="23.53%"
          helper="Closed recommendation target-hit rate"
          trend="↓ calibrating"
        />
        <MetricCard
          label="Total P&L"
          value="-0.79%"
          helper="Current expectancy across closed sample"
          trend="risk"
        />
        <MetricCard
          label="Avg Return"
          value="-0.79%"
          helper="Average realized return"
          trend="audited"
        />
        <MetricCard
          label="Sharpe Ratio"
          value="-4.86"
          helper="Weak historical risk-adjusted output"
          trend="watch"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
                Win / Loss Distribution
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                TARGET_HIT vs STOP_HIT vs currently OPEN outcomes.
              </p>
            </div>
            <Badge tone="open">{closed} Closed</Badge>
          </div>

          <WinRateChart
            targetHit={targetHit}
            stopHit={stopHit}
            open={open}
            closed={closed}
          />

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <p className="mono text-lg text-[var(--accent-green)]">{targetHit}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Target hit</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <p className="mono text-lg text-[var(--accent-red)]">{stopHit}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Stop hit</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <p className="mono text-lg text-[var(--accent-primary)]">{open}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Open</p>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
                Recommendations Over Time
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Cumulative recommendation tracking volume.
              </p>
            </div>
            <Badge tone="neutral">{formatNumber(total)} Total</Badge>
          </div>

          <div className="mt-6">
            <PerformanceChart data={performanceData} />
          </div>
        </Card>
      </section>

      <Card>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              Strategy Breakdown
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              9 strategy groups from the statistical validation layer.
            </p>
          </div>
          <Badge tone="purple">9 Groups</Badge>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-[var(--border)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead className="bg-[var(--bg-elevated)]">
                <tr className="text-left text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th className="px-4 py-4 font-semibold">Strategy</th>
                  <th className="px-4 py-4 font-semibold">Count</th>
                  <th className="px-4 py-4 font-semibold">Win Rate</th>
                  <th className="px-4 py-4 font-semibold">Avg Return</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-subtle)]">
                {strategies.map((item) => (
                  <tr
                    key={item.strategy}
                    className="transition hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="px-4 py-4 text-sm font-medium text-[var(--text-primary)]">
                      {item.strategy}
                    </td>
                    <td className="mono px-4 py-4 text-sm text-[var(--text-secondary)]">
                      {item.count}
                    </td>
                    <td className="mono px-4 py-4 text-sm text-[var(--accent-amber)]">
                      {item.winRate.toFixed(1)}%
                    </td>
                    <td
                      className={`mono px-4 py-4 text-sm font-semibold ${
                        item.avgReturn >= 0
                          ? "text-[var(--accent-green)]"
                          : "text-[var(--accent-red)]"
                      }`}
                    >
                      {item.avgReturn >= 0 ? "+" : ""}
                      {item.avgReturn.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <div className="rounded-xl border border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.06)] p-4">
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--accent-amber)]">
            Disclaimer:
          </span>{" "}
          Past performance is not indicative of future results. Model is under active
          calibration. SEBI registration is required for advisory use.
        </p>
      </div>
    </motion.div>
  );
}
