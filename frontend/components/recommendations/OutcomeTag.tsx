import { Badge } from "@/components/ui/Badge";

interface OutcomeTagProps {
  status?: string | null;
}

export function OutcomeTag({ status }: OutcomeTagProps) {
  const value = String(status || "OPEN").toUpperCase();

  if (value.includes("TARGET")) {
    return <Badge tone="target">✓ Target Hit</Badge>;
  }

  if (value.includes("STOP")) {
    return <Badge tone="stop">✕ Stop Hit</Badge>;
  }

  if (value.includes("EXPIRED")) {
    return <Badge tone="hold">Expired</Badge>;
  }

  return <Badge tone="open">● Live</Badge>;
}
