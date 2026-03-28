import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import GlassCard from './GlassCard';

export default function MetricCard({
  title,
  value,
  unit,
  change,
  changeLabel,
  icon: Icon,
  color = 'blue',
}) {
  const colorClasses = {
    blue: 'from-[#e7efff] via-white to-[#f8fbff]',
    green: 'from-[#e9f7ef] via-white to-[#f8fdf9]',
    orange: 'from-[#fff1e2] via-white to-[#fffaf4]',
    red: 'from-[#ffe8e5] via-white to-[#fff8f7]',
    purple: 'from-[#ece9ff] via-white to-[#faf9ff]',
  };

  const iconColorClasses = {
    blue: 'bg-[#dfe8ff] text-[#2f63d6]',
    green: 'bg-[#e1f6ea] text-[#269e5b]',
    orange: 'bg-[#ffedd7] text-[#dd7a08]',
    red: 'bg-[#ffe4e0] text-[#d74436]',
    purple: 'bg-[#ebe5ff] text-[#6253d4]',
  };

  const TrendIcon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const trendColor = change > 0 ? 'text-apple-red' : change < 0 ? 'text-apple-green' : 'text-apple-gray-400';

  return (
    <GlassCard hover className={`bg-gradient-to-br ${colorClasses[color]} p-6`}>
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-[18px] ${iconColorClasses[color]} shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]`}>
          {Icon && <Icon className="w-5 h-5" />}
        </div>
        {change !== undefined && (
          <div className={`flex items-center gap-1 rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-medium ${trendColor}`}>
            <TrendIcon className="w-3 h-3" />
            <span>{Math.abs(change)}%</span>
          </div>
        )}
      </div>

      <div className="mt-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-apple-gray-400">{title}</p>
        <div className="mt-2 flex items-end gap-2">
          <span className="text-3xl font-semibold tracking-tight text-apple-gray-800 tabular-nums">
            {value}
          </span>
          {unit && <span className="pb-1 text-sm text-apple-gray-400">{unit}</span>}
        </div>
        {changeLabel && (
          <p className="mt-2 text-sm text-apple-gray-500">{changeLabel}</p>
        )}
      </div>
    </GlassCard>
  );
}
