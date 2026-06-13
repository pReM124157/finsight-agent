import type { AnalysisResult } from "@/types";
import { Card } from "@/components/ui/Card";

interface AgentGridProps {
  result: AnalysisResult;
}

function stringify(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function AgentGrid({ result }: AgentGridProps) {
  const agents = [
    {
      title: "Research Agent",
      accent: "var(--accent-primary)",
      content: stringify(
        result.analysis?.stockFundamentals || result.reason,
        "Fundamental context unavailable for this run."
      ),
    },
    {
      title: "Risk Agent",
      accent: "var(--accent-red)",
      content: stringify(
        result.risk?.majorRisks || result.risk?.riskLevel,
        "No major risk packet returned."
      ),
    },
    {
      title: "Learning Agent",
      accent: "var(--accent-purple)",
      content: stringify(
        result.learning?.learningInsight,
        "Learning signal still calibrating."
      ),
    },
    {
      title: "Performance Agent",
      accent: "var(--accent-green)",
      content: stringify(
        result.performance?.performanceInsight,
        "Performance score unavailable for this symbol."
      ),
    },
    {
      title: "Portfolio Agent",
      accent: "var(--accent-amber)",
      content: stringify(
        result.portfolio?.dominantSector || result.portfolio?.healthScore,
        "Portfolio context not attached to this run."
      ),
    },
    {
      title: "Rebalancing Agent",
      accent: "var(--accent-primary)",
      content: stringify(
        result.rebalancing?.rebalancingAdvice || result.capitalAction,
        "No rebalancing action required."
      ),
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {agents.map((agent) => (
        <Card
          key={agent.title}
          className="relative min-h-[164px] overflow-hidden border-l-2"
          style={{ borderLeftColor: agent.accent }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {agent.title}
          </p>
          <p className="mt-4 line-clamp-5 text-sm leading-6 text-[var(--text-secondary)]">
            {agent.content}
          </p>
        </Card>
      ))}
    </div>
  );
}
