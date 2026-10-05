import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDay } from "../lib/dates";
import { fmtNum } from "./ui";

export type Point = { date: string; value: number };

type Props = {
  /** Raw daily readings, drawn as dots. */
  points?: Point[];
  /** Smoothed series, drawn as the line. */
  line: Point[];
  lineLabel: string;
  pointsLabel?: string;
  goal?: number | null;
  unit?: string;
  height?: number;
};

const PAD = { top: 14, right: 46, bottom: 24, left: 36 };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.01; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const dayMs = (d: string) => new Date(`${d}T12:00:00`).getTime();

/** Single-axis time series: dots for raw readings, a 2px line for the trend, optional goal rule. */
export function LineChart({ points = [], line, lineLabel, pointsLabel, goal, unit = "", height = 200 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const all = [...points, ...line];
    if (!all.length) return null;
    const xs = all.map((p) => dayMs(p.date));
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (x1 === x0) {
      x0 -= 86_400_000 * 3;
      x1 += 86_400_000 * 3;
    }
    const vals = all.map((p) => p.value).concat(goal && goal > 0 ? [goal] : []);
    let y0 = Math.min(...vals);
    let y1 = Math.max(...vals);
    const padY = Math.max((y1 - y0) * 0.12, 0.5);
    y0 -= padY;
    y1 += padY;
    const ticks = niceTicks(y0, y1);
    y0 = Math.min(y0, ticks[0]);
    y1 = Math.max(y1, ticks.at(-1)!);
    const iw = width - PAD.left - PAD.right;
    const ih = height - PAD.top - PAD.bottom;
    const x = (d: string) => PAD.left + ((dayMs(d) - x0) / (x1 - x0)) * iw;
    const y = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0)) * ih;
    return { x, y, ticks: ticks.filter((t) => t >= y0 && t <= y1), iw, ih };
  }, [points, line, goal, width, height]);

  if (!geo) return null;
  const { x, y, ticks } = geo;
  const path = line.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const last = line.at(-1);
  const xLabels = line.length > 2 ? [line[0], line[Math.floor(line.length / 2)], line.at(-1)!] : line;

  const hovered = hover !== null ? line[hover] : null;
  const hoveredRaw = hovered ? points.find((p) => p.date === hovered.date) : null;

  const onMove = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    line.forEach((p, i) => {
      const d = Math.abs(x(p.date) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div>
      <div
        ref={wrap}
        className="chart-wrap"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={height} role="img" aria-label={`${lineLabel} chart`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
                {fmtNum(t, 1)}
              </text>
            </g>
          ))}
          {goal && goal > 0 && (
            <g>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(goal)} y2={y(goal)} stroke="var(--oak)" strokeWidth={1} />
              <text x={width - PAD.right + 4} y={y(goal) + 4} fontSize={11} fill="var(--ink-2)">
                Goal
              </text>
            </g>
          )}
          {points.map((p) => (
            <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={3.5} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={1.5} opacity={0.85} />
          ))}
          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last && (
            <g>
              <circle cx={x(last.date)} cy={y(last.value)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
              <text x={x(last.date) + 8} y={y(last.value) + 4} fontSize={12} fontWeight={600} fill="var(--ink)">
                {fmtNum(last.value)}
              </text>
            </g>
          )}
          {xLabels.map((p, i) => (
            <text
              key={p.date + i}
              x={x(p.date)}
              y={height - 6}
              fontSize={11}
              fill="var(--ink-3)"
              textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
            >
              {new Date(`${p.date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
            </text>
          ))}
          {hovered && (
            <g>
              <line x1={x(hovered.date)} x2={x(hovered.date)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--ink-3)" strokeWidth={1} />
              <circle cx={x(hovered.date)} cy={y(hovered.value)} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hovered && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(x(hovered.date), 70), width - 70) }}>
            <strong>{fmtDay(hovered.date)}</strong>
            <br />
            {lineLabel}: {fmtNum(hovered.value)} {unit}
            {hoveredRaw && pointsLabel && (
              <>
                <br />
                {pointsLabel}: {fmtNum(hoveredRaw.value)} {unit}
              </>
            )}
          </div>
        )}
      </div>
      {points.length > 0 && pointsLabel && (
        <div className="legend">
          <span>
            <svg width="18" height="8" aria-hidden="true">
              <line x1="1" x2="17" y1="4" y2="4" stroke="var(--series-1)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {lineLabel}
          </span>
          <span>
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="4" fill="var(--series-2)" />
            </svg>
            {pointsLabel}
          </span>
          {goal ? (
            <span>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="1" x2="17" y1="4" y2="4" stroke="var(--oak)" strokeWidth="1" />
              </svg>
              Goal {fmtNum(goal)}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
