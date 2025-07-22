import React from "react";

interface ProfitLossGaugeProps {
  percent: number; // -100 to 100 (negative for loss, positive for profit)
  isProfit: boolean;
}

const RADIUS = 90;
const STROKE = 20;
const CIRCUM = Math.PI * RADIUS;

const ProfitLossGauge: React.FC<ProfitLossGaugeProps> = ({ percent, isProfit }) => {
  // Clamp percent between -100 and 100
  const clamped = Math.max(-100, Math.min(100, percent));
  // Map percent to arc length (0% = left, 100% = right)
  const arc = (Math.abs(clamped) / 100) * CIRCUM;
  const arcColor = isProfit ? "#22c55e" : "#ef4444";

  return (
    <div className="flex flex-col items-center">
      <svg width={220} height={120} viewBox="0 0 220 120">
        {/* Background arc */}
        <path
          d="M20,110 A90,90 0 0,1 200,110"
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={STROKE}
        />
        {/* Foreground arc (dynamic) */}
        <path
          d="M20,110 A90,90 0 0,1 200,110"
          fill="none"
          stroke={arcColor}
          strokeWidth={STROKE}
          strokeDasharray={`${arc},${CIRCUM}`}
          strokeLinecap="round"
        />
      </svg>
      <div className={`text-2xl font-bold ${isProfit ? "text-green-600" : "text-red-600"}`}>{Math.abs(clamped).toFixed(1)}%</div>
      <div className={`uppercase font-semibold ${isProfit ? "text-green-600" : "text-red-600"}`}>{isProfit ? "Profit" : "Loss"}</div>
    </div>
  );
};

export default ProfitLossGauge; 