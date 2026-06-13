export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatINR(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return new Intl.NumberFormat("en-IN").format(Number(value));
}

export function formatPercent(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  const numericValue = Number(value);
  const prefix = numericValue > 0 ? "+" : "";

  return `${prefix}${numericValue.toFixed(decimals)}%`;
}

export function getReturnClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "text-[var(--text-muted)]";
  }

  if (Number(value) > 0) return "text-[var(--accent-green)]";
  if (Number(value) < 0) return "text-[var(--accent-red)]";

  return "text-[var(--text-secondary)]";
}

export function normalizeAction(action?: string | null) {
  const value = String(action || "HOLD").toUpperCase();

  if (value.includes("BUY")) return "BUY";
  if (value.includes("SELL")) return "SELL";
  return "HOLD";
}

export function formatDate(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}
