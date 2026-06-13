import type { AnalysisResult } from "@/types";
import { Card } from "@/components/ui/Card";

interface ReasoningPanelProps {
  result: AnalysisResult;
}

export function ReasoningPanel({ result }: ReasoningPanelProps) {
  const reasoning =
    result.decision?.reasoning ||
    result.reason ||
    result.entryTiming?.finalExecutionAdvice ||
    "No reasoning text returned by the master agent.";

  return (
    <Card className="bg-[var(--bg-elevated)]">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-purple)]">
        Master Agent Reasoning
      </p>
      <pre className="mono mt-4 whitespace-pre-wrap text-sm leading-7 text-[var(--text-secondary)]">
        {reasoning}
      </pre>
    </Card>
  );
}
