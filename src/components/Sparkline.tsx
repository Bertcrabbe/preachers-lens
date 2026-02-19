import { useMemo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  showAvgLine?: boolean;
  className?: string;
}

const Sparkline = ({ 
  data, 
  width = 120, 
  height = 32, 
  color = "hsl(var(--primary))", 
  fillColor,
  showAvgLine = false,
  className = "" 
}: SparklineProps) => {
  const { path, fillPath, avgY } = useMemo(() => {
    if (data.length < 2) return { path: "", fillPath: "", avgY: 0 };
    
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const w = width - padding * 2;
    const h = height - padding * 2;
    
    const points = data.map((val, i) => ({
      x: padding + (i / (data.length - 1)) * w,
      y: padding + h - ((val - min) / range) * h,
    }));
    
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const fill = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;
    
    const avg = data.reduce((s, v) => s + v, 0) / data.length;
    const aY = padding + h - ((avg - min) / range) * h;
    
    return { path: linePath, fillPath: fill, avgY: aY };
  }, [data, width, height]);

  if (data.length < 2) return null;

  const resolvedFill = fillColor || color;

  return (
    <svg width={width} height={height} className={className} style={{ display: "block" }}>
      {/* Fill area */}
      <path d={fillPath} fill={resolvedFill} opacity={0.15} />
      {/* Line */}
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Average line */}
      {showAvgLine && (
        <line x1={2} y1={avgY} x2={width - 2} y2={avgY} stroke={color} strokeWidth={0.75} strokeDasharray="3 2" opacity={0.5} />
      )}
    </svg>
  );
};

export default Sparkline;
