"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface WinRateChartProps {
  targetHit: number;
  stopHit: number;
  open: number;
  closed: number;
}

const COLORS = {
  target: "var(--accent-green)",
  stop: "var(--accent-red)",
  open: "var(--accent-primary)",
};

export function WinRateChart({
  targetHit,
  stopHit,
  open,
  closed,
}: WinRateChartProps) {
  const data = [
    { name: "TARGET_HIT", value: targetHit, color: COLORS.target },
    { name: "STOP_HIT", value: stopHit, color: COLORS.stop },
    { name: "OPEN", value: open, color: COLORS.open },
  ];

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            innerRadius={82}
            outerRadius={118}
            paddingAngle={3}
            dataKey="value"
            stroke="var(--bg-base)"
            strokeWidth={4}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>

          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              color: "var(--text-primary)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="pointer-events-none -mt-[190px] flex flex-col items-center justify-center">
        <p className="mono text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">
          {closed}
        </p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Closed</p>
      </div>
    </div>
  );
}
