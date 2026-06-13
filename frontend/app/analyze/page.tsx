"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, type Variants } from "framer-motion";
import { AgentGrid } from "@/components/analysis/AgentGrid";
import { AnalysisInput } from "@/components/analysis/AnalysisInput";
import { ReasoningPanel } from "@/components/analysis/ReasoningPanel";
import { VerdictCard } from "@/components/analysis/VerdictCard";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingPulse } from "@/components/ui/LoadingPulse";
import { api } from "@/lib/api";
import type { AnalysisResult } from "@/types";

const easeOut = [0, 0, 0.2, 1] as const;

const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOut } },
};

function AnalyzeContent() {
  const searchParams = useSearchParams();
  const symbolFromUrl = searchParams.get("symbol") || "";

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis(symbol: string) {
    setLoading(true);
    setError(null);

    const nextUrl = `/analyze?symbol=${encodeURIComponent(symbol)}`;
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }

    try {
      const payload = await api.analyze(symbol);
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis request failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const normalized = symbolFromUrl.trim().toUpperCase();
    if (normalized) {
      const timeoutId = window.setTimeout(() => {
        void runAnalysis(normalized);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Multi-Agent Analysis
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.05em] text-[var(--text-primary)] md:text-6xl">
          Stock <span className="gradient-text">Analysis</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--text-secondary)]">
          Run a full institutional-style analysis using live market data, risk checks,
          valuation context, execution safety, and agent-level reasoning.
        </p>
      </div>

      <AnalysisInput
        initialSymbol={symbolFromUrl}
        loading={loading}
        onSubmit={runAnalysis}
      />

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <Card>
            <LoadingPulse lines={8} />
          </Card>
          <Card>
            <LoadingPulse lines={10} />
          </Card>
        </div>
      ) : null}

      {error ? (
        <EmptyState
          title="Analysis failed"
          description={`${error} Check that the backend is running and NEXT_PUBLIC_API_URL points to the Render API.`}
        />
      ) : null}

      {!loading && !error && !result ? (
        <EmptyState
          title="Ready for analysis"
          description="Enter a symbol like TCS, ICICIBANK, RELIANCE, INFY, or HDFCBANK to generate a master-agent report."
        />
      ) : null}

      {!loading && !error && result ? (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div className="space-y-6">
              <VerdictCard result={result} />
              <ReasoningPanel result={result} />
            </div>

            <AgentGrid result={result} />
          </div>

          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Full Analysis Report
            </p>
            <pre className="mono mt-4 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-xs leading-6 text-[var(--text-secondary)]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </Card>
        </div>
      ) : null}
    </motion.div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<LoadingPulse lines={8} />}>
      <AnalyzeContent />
    </Suspense>
  );
}
