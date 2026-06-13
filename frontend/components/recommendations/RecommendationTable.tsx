"use client";

import { useMemo, useState } from "react";
import { Badge, getActionTone } from "@/components/ui/Badge";
import { OutcomeTag } from "@/components/recommendations/OutcomeTag";
import type { Recommendation } from "@/types";
import { formatDate, formatINR, formatPercent, getReturnClass } from "@/lib/utils";

interface RecommendationTableProps {
  rows: Recommendation[];
  filter: string;
}

const PAGE_SIZE = 20;

function getStatus(row: Recommendation) {
  return String(row.outcome_status || row.status || "OPEN").toUpperCase();
}

function getReturn(row: Recommendation) {
  const status = getStatus(row);

  if (status.includes("OPEN")) {
    return row.unrealized_return_pct ?? row.return_pct ?? null;
  }

  return row.realized_return_pct ?? row.return_pct ?? row.unrealized_return_pct ?? null;
}

function getEntry(row: Recommendation) {
  return row.entry_price ?? row.entryPrice ?? null;
}

function getTarget(row: Recommendation) {
  return row.target_price ?? row.targetPrice ?? null;
}

function getStop(row: Recommendation) {
  return row.stop_loss ?? row.stop_price ?? row.stopPrice ?? null;
}

function getDate(row: Recommendation) {
  return row.recommendation_created_at || row.created_at || null;
}

export function RecommendationTable({ rows, filter }: RecommendationTableProps) {
  const [page, setPage] = useState(1);

  const filteredRows = useMemo(() => {
    if (filter === "ALL") return rows;

    return rows.filter((row) => {
      const status = getStatus(row);
      const action = String(row.action || "").toUpperCase();

      if (filter === "BUY") return action.includes("BUY");
      if (filter === "SELL") return action.includes("SELL");

      return status.includes(filter);
    });
  }, [rows, filter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pageRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse">
          <thead className="bg-[var(--bg-elevated)]">
            <tr className="text-left text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <th className="px-4 py-4 font-semibold">Symbol</th>
              <th className="px-4 py-4 font-semibold">Action</th>
              <th className="px-4 py-4 font-semibold">Entry Price</th>
              <th className="px-4 py-4 font-semibold">Target</th>
              <th className="px-4 py-4 font-semibold">Stop</th>
              <th className="px-4 py-4 font-semibold">Status</th>
              <th className="px-4 py-4 font-semibold">Return %</th>
              <th className="px-4 py-4 font-semibold">Date</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--border-subtle)]">
            {pageRows.map((row, index) => {
              const action = row.action || "HOLD";
              const returnPct = getReturn(row);

              return (
                <tr
                  key={row.recommendation_id || row.id || `${row.symbol}-${index}`}
                  className="transition hover:bg-[var(--bg-elevated)]"
                >
                  <td className="mono px-4 py-4 text-sm font-semibold text-[var(--text-primary)]">
                    {row.symbol}
                  </td>

                  <td className="px-4 py-4">
                    <Badge tone={getActionTone(action)}>{action}</Badge>
                  </td>

                  <td className="mono px-4 py-4 text-sm text-[var(--text-secondary)]">
                    {formatINR(getEntry(row))}
                  </td>

                  <td className="mono px-4 py-4 text-sm text-[var(--text-secondary)]">
                    {formatINR(getTarget(row))}
                  </td>

                  <td className="mono px-4 py-4 text-sm text-[var(--text-secondary)]">
                    {formatINR(getStop(row))}
                  </td>

                  <td className="px-4 py-4">
                    <OutcomeTag status={getStatus(row)} />
                  </td>

                  <td className={`mono px-4 py-4 text-sm font-semibold ${getReturnClass(returnPct)}`}>
                    {formatPercent(returnPct)}
                  </td>

                  <td className="px-4 py-4 text-sm text-[var(--text-secondary)]">
                    {formatDate(getDate(row))}
                  </td>
                </tr>
              );
            })}

            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-[var(--text-secondary)]"
                >
                  No recommendations match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 py-4">
        <p className="text-sm text-[var(--text-muted)]">
          Showing <span className="mono text-[var(--text-secondary)]">{pageRows.length}</span> of{" "}
          <span className="mono text-[var(--text-secondary)]">{filteredRows.length}</span>
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[#2E3D52] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>

          <span className="mono text-sm text-[var(--text-muted)]">
            {currentPage}/{totalPages}
          </span>

          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:border-[#2E3D52] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
