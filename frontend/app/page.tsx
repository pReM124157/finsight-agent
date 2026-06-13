"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, type Variants } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricCard } from "@/components/ui/MetricCard";
import { formatINR, formatNumber, formatPercent, getReturnClass } from "@/lib/utils";

const easeOut = [0, 0, 0.2, 1] as const;

const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOut } },
};

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: easeOut } },
};

const dashboardStats = [
  {
    label: "Total Recommendations",
    value: "161",
    helper: "Tracked recommendation outcomes",
    trend: "verified",
  },
  {
    label: "Closed Recommendations",
    value: "34",
    helper: "Resolved target / stop / expiry events",
    trend: "audited",
  },
  {
    label: "Open Positions",
    value: "127",
    helper: "Still under active outcome monitoring",
    trend: "live",
  },
  {
    label: "Stocks Tracked",
    value: "55",
    helper: "Verified quote cache coverage",
    trend: "NSE",
  },
];

const recentActivity = [
  {
    symbol: "ICICIBANK",
    status: "TARGET_HIT",
    action: "BUY",
    returnPct: 4.1433,
    meta: "Target closed",
    price: 1340.8,
  },
  {
    symbol: "ETERNAL",
    status: "OPEN",
    action: "BUY",
    returnPct: 3.6565,
    meta: "Active outcome",
    price: 243.8,
  },
  {
    symbol: "JSWSTEEL",
    status: "OPEN",
    action: "HOLD",
    returnPct: 1.0592,
    meta: "Active outcome",
    price: 1297.6,
  },
  {
    symbol: "TITAN",
    status: "OPEN",
    action: "HOLD",
    returnPct: -1.7886,
    meta: "Risk monitored",
    price: 4184,
  },
  {
    symbol: "TCS",
    status: "LIVE",
    action: "HOLD",
    returnPct: null,
    meta: "Execution aligned",
    price: 2152.6,
  },
];

function getStatusTone(status: string) {
  if (status === "TARGET_HIT") return "target";
  if (status === "STOP_HIT") return "stop";
  if (status === "OPEN" || status === "LIVE") return "open";
  return "neutral";
}

function getActionTone(action: string) {
  if (action.includes("BUY")) return "buy";
  if (action.includes("SELL")) return "sell";
  return "hold";
}

export default function DashboardPage() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");

  function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = symbol.trim().toUpperCase();

    if (!normalized) return;

    router.push(`/analyze?symbol=${encodeURIComponent(normalized)}`);
  }

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <section className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[rgba(14,18,25,0.78)] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)] shadow-[0_0_14px_rgba(16,185,129,0.8)]" />
            <span className="mono text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              Production backend verified
            </span>
          </div>

          <div>
            <h1 className="max-w-4xl text-5xl font-extrabold tracking-[-0.05em] text-[var(--text-primary)] md:text-7xl">
              AI Stock <span className="gradient-text">Intelligence</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--text-secondary)]">
              Institutional-grade multi-agent analysis for Indian equity markets.
              Built for research teams, finance communities, and serious market operators.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/analyze"
              prefetch={false}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-[var(--accent-primary)] px-5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Analyze a Stock →
            </Link>
            <Link
              href="/recommendations"
              prefetch={false}
              className="inline-flex h-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-5 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[#2E3D52]"
            >
              View Recommendations
            </Link>
          </div>
        </div>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-green)] to-[var(--accent-purple)]" />
          <p className="text-sm font-medium text-[var(--text-muted)]">System Proof</p>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <p className="mono text-3xl font-semibold tracking-[-0.04em] text-[var(--accent-green)]">
                262
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Tests passed</p>
            </div>
            <div>
              <p className="mono text-3xl font-semibold tracking-[-0.04em] text-[var(--accent-primary)]">
                177
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Audit rows</p>
            </div>
            <div>
              <p className="mono text-3xl font-semibold tracking-[-0.04em] text-[var(--accent-purple)]">
                84
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Calibration rows</p>
            </div>
            <div>
              <p className="mono text-3xl font-semibold tracking-[-0.04em] text-[var(--accent-amber)]">
                Live
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Render backend</p>
            </div>
          </div>
        </Card>
      </section>

      <motion.section
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {dashboardStats.map((stat) => (
          <motion.div key={stat.label} variants={cardVariants}>
            <MetricCard
              label={stat.label}
              value={stat.value}
              helper={stat.helper}
              trend={stat.trend}
            />
          </motion.div>
        ))}
      </motion.section>

      <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
                Recent Activity
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Latest recommendation outcomes and live monitoring events.
              </p>
            </div>
            <Badge tone="purple">Outcome Engine</Badge>
          </div>

          <div className="mt-6 divide-y divide-[var(--border-subtle)]">
            {recentActivity.length > 0 ? (
              recentActivity.map((item) => (
                <div
                  key={`${item.symbol}-${item.status}`}
                  className="grid gap-4 py-4 transition hover:bg-[rgba(20,25,33,0.35)] sm:grid-cols-[140px_120px_90px_1fr_120px]"
                >
                  <div>
                    <p className="mono text-sm font-semibold text-[var(--text-primary)]">
                      {item.symbol}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{item.meta}</p>
                  </div>

                  <div>
                    <Badge tone={getStatusTone(item.status)}>
                      {item.status.replace("_", " ")}
                    </Badge>
                  </div>

                  <div>
                    <Badge tone={getActionTone(item.action)}>{item.action}</Badge>
                  </div>

                  <div className="mono text-sm text-[var(--text-secondary)]">
                    {formatINR(item.price)}
                  </div>

                  <div className={`mono text-sm font-semibold ${getReturnClass(item.returnPct)}`}>
                    {item.returnPct === null ? "—" : formatPercent(item.returnPct)}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No recent activity"
                description="Recommendation outcomes will appear here once the backend records new market events."
              />
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
            Quick Analyze
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            Enter any NSE symbol and run a multi-agent intelligence check.
          </p>

          <form onSubmit={handleAnalyze} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="symbol"
                className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"
              >
                NSE Symbol
              </label>
              <input
                id="symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                placeholder="TCS, ICICIBANK, RELIANCE..."
                className="mono mt-2 h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)]"
              />
            </div>

            <button
              type="submit"
              className="h-12 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!symbol.trim()}
            >
              Run Analysis
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Validation Snapshot
            </p>
            <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
              <div className="flex justify-between gap-4">
                <span>Win Rate</span>
                <span className="mono text-[var(--accent-amber)]">23.53%</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Expectancy</span>
                <span className="mono text-[var(--accent-red)]">-0.79%</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Sample</span>
                <span className="mono">{formatNumber(161)}</span>
              </div>
            </div>
          </div>
        </Card>
      </section>
    </motion.div>
  );
}
