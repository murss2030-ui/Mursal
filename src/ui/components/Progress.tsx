/** Progress visuals. Each carries a text alternative: colour never carries the meaning alone. */
import type { ReactNode } from 'react';

export function ProgressRing({
  value,
  total,
  size = 64,
  stroke = 7,
  trackClass = 'stroke-slate-200',
  barClass = 'stroke-teal-700',
  label,
  children,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  trackClass?: string;
  barClass?: string;
  label: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={trackClass} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          className={`${barClass} transition-[stroke-dasharray] duration-500`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        {children}
      </span>
    </span>
  );
}

export function ProgressBar({ value, total, barClass = 'bg-teal-700', label }: { value: number; total: number; barClass?: string; label: string }) {
  const pct = total > 0 ? Math.round((100 * Math.min(value, total)) / total) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-label={label}>
      <span className={`block h-full rounded-full ${barClass} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </span>
  );
}
