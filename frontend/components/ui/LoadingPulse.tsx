import { cn } from "@/lib/utils";

interface LoadingPulseProps {
  className?: string;
  lines?: number;
}

export function LoadingPulse({ className, lines = 3 }: LoadingPulseProps) {
  return (
    <div className={cn("space-y-3", className)} aria-label="Loading content">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "skeleton h-4 rounded-md",
            index === lines - 1 ? "w-2/3" : "w-full"
          )}
        />
      ))}
    </div>
  );
}
