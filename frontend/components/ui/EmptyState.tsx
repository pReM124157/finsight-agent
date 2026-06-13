import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Card className="flex min-h-[220px] flex-col items-center justify-center text-center">
      <div className="mb-4 h-2 w-16 rounded-full bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-green)] to-[var(--accent-purple)]" />
      <h3 className="text-lg font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}
