"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/types";
import { Badge, getActionTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/utils";

interface VerdictCardProps {
  result: AnalysisResult;
}

function getDecision(result: AnalysisResult) {
  return (
    result.action ||
    result.decision?.finalAction ||
    result.decision?.finalDecision ||
    "HOLD"
  );
}

function getConfidence(result: AnalysisResult) {
  return (
    result.confidence ??
    result.decision?.confidenceScore ??
    result.decision?.finalConfidenceScore ??
    0
  );
}

export function VerdictCard({ result }: VerdictCardProps) {
  const [downloading, setDownloading] = useState(false);
  const action = getDecision(result);
  const confidence = Number(getConfidence(result) || 0);
  const confidenceOutOfTen = confidence > 10 ? confidence / 10 : confidence;
  const confidenceWidth = Math.max(0, Math.min(100, confidenceOutOfTen * 10));
  const symbol = (result.stock || result.symbol || "").trim().toUpperCase();

  async function handleDownloadPDF() {
    if (!symbol || downloading) return;

    setDownloading(true);
    try {
      const blob = await api.downloadReport(symbol);
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `Finsight_${symbol}_Report.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "PDF generation failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-green)] to-[var(--accent-purple)]" />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Final Executable Verdict
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <h2 className="mono text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">
              {result.stock || result.symbol}
            </h2>
            <Badge tone={getActionTone(action)} className="mb-1 text-sm">
              {action}
            </Badge>
          </div>

          <p className="mono mt-4 text-3xl font-semibold tracking-[-0.04em] text-[var(--accent-green)]">
            {formatINR(result.currentPrice)}
          </p>
        </div>

        <div className="min-w-[220px] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-secondary)]">Confidence</span>
            <span className="mono text-sm text-[var(--text-primary)]">
              {confidenceOutOfTen.toFixed(1)}/10
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border-subtle)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-green)]"
              style={{ width: `${confidenceWidth}%` }}
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
            Confidence is execution-aware and can differ from raw model conviction.
          </p>
          <button
            type="button"
            onClick={handleDownloadPDF}
            disabled={downloading || !symbol}
            className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[var(--accent-primary)]/35 bg-[var(--accent-primary)]/10 px-4 text-sm font-medium text-[var(--accent-primary)] transition hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? "Generating PDF..." : "Download Report"}
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Entry Strategy
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            {result.entryTiming?.strategy || "Awaiting structure confirmation"}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Exit Signal
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            {result.exitSignal?.signal || "No active exit signal"}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Live Status
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            {result.isLive ? "Verified live market data" : "Delayed / cached market data"}
          </p>
        </div>
      </div>
    </Card>
  );
}
