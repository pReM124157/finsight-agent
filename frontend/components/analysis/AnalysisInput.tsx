"use client";

import { FormEvent, useState } from "react";

interface AnalysisInputProps {
  initialSymbol?: string;
  loading?: boolean;
  onSubmit: (symbol: string) => void;
}

export function AnalysisInput({
  initialSymbol = "",
  loading = false,
  onSubmit,
}: AnalysisInputProps) {
  const [symbol, setSymbol] = useState(initialSymbol);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = symbol.trim().toUpperCase();
    if (!normalized || loading) return;

    onSubmit(normalized);
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <label
        htmlFor="analysis-symbol"
        className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
      >
        Stock Analysis
      </label>

      <div className="mt-4 flex flex-col gap-3 md:flex-row">
        <input
          id="analysis-symbol"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
          placeholder="Enter NSE symbol (TCS, ICICIBANK, RELIANCE...)"
          className="mono h-14 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)]"
        />

        <button
          type="submit"
          disabled={!symbol.trim() || loading}
          className="h-14 rounded-xl bg-[var(--accent-primary)] px-6 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Run Analysis"}
        </button>
      </div>

      <p className="mt-3 text-sm text-[var(--text-muted)]">
        262 tests passing · Live NSE data · Multi-agent analysis
      </p>
    </form>
  );
}
