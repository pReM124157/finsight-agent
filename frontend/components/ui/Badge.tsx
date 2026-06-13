import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "buy" | "sell" | "hold" | "target" | "stop" | "open" | "neutral" | "purple";

const toneClass: Record<BadgeTone, string> = {
  buy: "badge-buy",
  sell: "badge-sell",
  hold: "badge-hold",
  target: "badge-target",
  stop: "badge-stop",
  open: "badge-open",
  neutral: "border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
  purple: "border border-[rgba(139,92,246,0.28)] bg-[rgba(139,92,246,0.1)] text-[var(--accent-purple)]",
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em]",
        toneClass[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function getActionTone(action?: string): BadgeTone {
  const value = String(action || "").toUpperCase();

  if (value.includes("BUY")) return "buy";
  if (value.includes("SELL")) return "sell";
  if (value.includes("HOLD")) return "hold";

  return "neutral";
}

export function getOutcomeTone(status?: string): BadgeTone {
  const value = String(status || "").toUpperCase();

  if (value.includes("TARGET")) return "target";
  if (value.includes("STOP")) return "stop";
  if (value.includes("OPEN")) return "open";
  if (value.includes("EXPIRED")) return "hold";

  return "neutral";
}
