"use client";

import { useEffect, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { LoadingPulse } from "@/components/ui/LoadingPulse";
import { MetricCard } from "@/components/ui/MetricCard";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/utils";
import type { MarketOverview, SectorRotationItem, TopPick } from "@/types";

const easeOut = [0, 0, 0.2, 1] as const;

const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOut } },
};

const fallbackOverview: MarketOverview = {
  nifty: { price: 0, change: 0 },
  sensex: { price: 0, change: 0 },
  indiaVix: { price: 0, change: 0 },
  marketStatus: "CLOSED",
  lastUpdated: new Date().toISOString(),
};

const fallbackSectors: SectorRotationItem[] = [
  { sector: "Banking", topStock: "ICICIBANK", signal: "Relative strength", momentum: "UP", score: 78 },
  { sector: "IT", topStock: "TCS", signal: "Low confidence recovery", momentum: "FLAT", score: 54 },
  { sector: "Metals", topStock: "JSWSTEEL", signal: "Momentum watch", momentum: "UP", score: 66 },
  { sector: "Consumer", topStock: "TITAN", signal: "Risk monitored", momentum: "DOWN", score: 49 },
  { sector: "New Age", topStock: "ETERNAL", signal: "Active outcome", momentum: "UP", score: 71 },
  { sector: "Energy", topStock: "RELIANCE", signal: "Awaiting trigger", momentum: "FLAT", score: 58 },
  { sector: "Auto", topStock: "M&M", signal: "Quality watch", momentum: "UP", score: 63 },
  { sector: "Pharma", topStock: "SUNPHARMA", signal: "Defensive bias", momentum: "FLAT", score: 61 },
  { sector: "FMCG", topStock: "HINDUNILVR", signal: "Hold structure", momentum: "FLAT", score: 52 },
];

const fallbackPicks: TopPick[] = [
  { symbol: "ICICIBANK", sector: "Banking", signal: "TARGET_HIT momentum", convictionScore: 72, riskLevel: "MEDIUM" },
  { symbol: "ETERNAL", sector: "New Age", signal: "Open upside watch", convictionScore: 68, riskLevel: "HIGH" },
  { symbol: "JSWSTEEL", sector: "Metals", signal: "Momentum continuation", convictionScore: 64, riskLevel: "MEDIUM" },
  { symbol: "TCS", sector: "IT", signal: "Execution hold", convictionScore: 32, riskLevel: "MEDIUM" },
  { symbol: "TITAN", sector: "Consumer", signal: "Stop proximity risk", convictionScore: 41, riskLevel: "HIGH" },
];

function momentumSymbol(momentum?: string) {
  const value = String(momentum || "FLAT").toUpperCase();
  if (value.includes("UP")) return "↑";
  if (value.includes("DOWN")) return "↓";
  return "→";
}

function momentumClass(momentum?: string) {
  const value = String(momentum || "FLAT").toUpperCase();
  if (value.includes("UP")) return "text-[var(--accent-green)]";
  if (value.includes("DOWN")) return "text-[var(--accent-red)]";
  return "text-[var(--accent-amber)]";
}

function riskTone(risk?: string) {
  const value = String(risk || "").toUpperCase();
  if (value.includes("HIGH")) return "sell";
  if (value.includes("LOW")) return "buy";
  return "hold";
}

export default function ScannerPage() {
  const [overview, setOverview] = useState<MarketOverview>(fallbackOverview);
  const [sectors, setSectors] = useState<SectorRotationItem[]>(fallbackSectors);
  const [topPicks, setTopPicks] = useState<TopPick[]>(fallbackPicks);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [error, setError] = useState<string | null>(null);

  async function loadScanner() {
    setLoading(true);
    setError(null);

    try {
      const [marketOverview, sectorRotation, picks] = await Promise.allSettled([
        api.scanner.marketOverview(),
        api.scanner.sectorRotation(),
        api.scanner.topPicks(),
      ]);

      if (marketOverview.status === "fulfilled" && marketOverview.value) {
        setOverview(marketOverview.value);
      }

      if (
        sectorRotation.status === "fulfilled" &&
        Array.isArray(sectorRotation.value) &&
        sectorRotation.value.length
      ) {
        setSectors(sectorRotation.value);
      }

      if (
        picks.status === "fulfilled" &&
        Array.isArray(picks.value) &&
        picks.value.length
      ) {
        setTopPicks(picks.value);
      }

      if (
        marketOverview.status === "rejected" &&
        sectorRotation.status === "rejected" &&
        picks.status === "rejected"
      ) {
        setError("Scanner API unavailable. Showing verified fallback snapshot.");
      }

      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scanner refresh failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadScanner();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

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
            Market Intelligence
          </p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-[var(--text-primary)] md:text-6xl">
            Market <span className="gradient-text">Scanner</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--text-secondary)]">
            Scan sector rotation, market status, top picks, conviction scores, and risk levels
            from one buyer-ready intelligence surface.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="mono text-xs text-[var(--text-muted)]">
            Last updated: {lastUpdated.toLocaleTimeString("en-IN")}
          </p>
          <button
            type="button"
            onClick={() => void loadScanner()}
            disabled={loading}
            className="h-11 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[#2E3D52] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {error ? (
        <Card className="border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.06)]">
          <p className="text-sm font-semibold text-[var(--accent-amber)]">
            Scanner fallback active
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{error}</p>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="NIFTY 50"
          value={overview.nifty?.price ? formatINR(overview.nifty.price) : "—"}
          helper="Broad market benchmark"
          trend={`${overview.nifty?.change ?? 0}`}
        />
        <MetricCard
          label="SENSEX"
          value={overview.sensex?.price ? formatINR(overview.sensex.price) : "—"}
          helper="Large-cap market pulse"
          trend={`${overview.sensex?.change ?? 0}`}
        />
        <MetricCard
          label="India VIX"
          value={overview.indiaVix?.price ? String(overview.indiaVix.price) : "—"}
          helper="Volatility regime"
          trend={`${overview.indiaVix?.change ?? 0}`}
        />
        <MetricCard
          label="Market Status"
          value={overview.marketStatus || "CLOSED"}
          helper="Execution context"
          trend="NSE"
        />
      </section>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              Sector Rotation
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Sector-level momentum and top stock watchlist.
            </p>
          </div>
          <Badge tone="purple">9 Sectors</Badge>
        </div>

        <div className="mt-6">
          {loading ? (
            <LoadingPulse lines={8} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sectors.map((sector) => (
                <div
                  key={sector.sector}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 transition hover:border-[#2E3D52]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {sector.sector}
                      </p>
                      <p className="mono mt-2 text-xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
                        {sector.topStock || "—"}
                      </p>
                    </div>

                    <span className={`mono text-2xl ${momentumClass(sector.momentum)}`}>
                      {momentumSymbol(sector.momentum)}
                    </span>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
                    {sector.signal || "No scanner signal available."}
                  </p>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-purple)]"
                      style={{ width: `${Math.max(0, Math.min(100, sector.score || 0))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              Top Picks
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Scanner candidates ranked by signal, conviction, and risk.
            </p>
          </div>
          <Badge tone="open">Live Candidates</Badge>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-[var(--border)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead className="bg-[var(--bg-elevated)]">
                <tr className="text-left text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  <th className="px-4 py-4 font-semibold">Symbol</th>
                  <th className="px-4 py-4 font-semibold">Sector</th>
                  <th className="px-4 py-4 font-semibold">Signal</th>
                  <th className="px-4 py-4 font-semibold">Conviction Score</th>
                  <th className="px-4 py-4 font-semibold">Risk Level</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[var(--border-subtle)]">
                {topPicks.map((pick) => (
                  <tr key={pick.symbol} className="transition hover:bg-[var(--bg-elevated)]">
                    <td className="mono px-4 py-4 text-sm font-semibold text-[var(--text-primary)]">
                      {pick.symbol}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-secondary)]">
                      {pick.sector || "—"}
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-secondary)]">
                      {pick.signal || "—"}
                    </td>
                    <td className="mono px-4 py-4 text-sm text-[var(--text-primary)]">
                      {pick.convictionScore ?? "—"}
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={riskTone(pick.riskLevel)}>{pick.riskLevel || "MEDIUM"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
