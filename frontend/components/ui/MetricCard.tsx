"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  helper?: string;
  trend?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
  helper,
  trend,
  className,
}: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
    >
      <Card className={cn("min-h-[132px]", className)}>
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-medium text-[var(--text-muted)]">{label}</p>
          {trend ? (
            <span className="mono rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]">
              {trend}
            </span>
          ) : null}
        </div>

        <div className="mono mt-5 text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
          {value}
        </div>

        {helper ? (
          <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{helper}</p>
        ) : null}
      </Card>
    </motion.div>
  );
}
