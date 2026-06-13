"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface PerformancePoint {
  date: string;
  recommendations: number;
}

interface PerformanceChartProps {
  data: PerformancePoint[];
}

export function PerformanceChart({ data }: PerformanceChartProps) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 4 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            stroke="var(--text-muted)"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            stroke="var(--text-muted)"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              color: "var(--text-primary)",
            }}
          />
          <Line
            type="monotone"
            dataKey="recommendations"
            stroke="var(--accent-primary)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: "var(--accent-primary)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
