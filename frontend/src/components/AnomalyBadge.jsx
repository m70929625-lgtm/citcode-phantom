import { AlertTriangle, Zap, TrendingDown, Clock } from 'lucide-react';
import { getAnomalyTypeLabel, getAnomalyTypeColor, formatRelativeTime, formatPercent } from '../utils/formatters';

export default function AnomalyBadge({ type, score, confidence, showDetails = false }) {
  const icons = {
    IDLE_INSTANCE: Clock,
    ZOMBIE_INSTANCE: TrendingDown,
    COST_SPIKE: AlertTriangle,
    RESOURCE_BURN: Zap,
    SCHEDULED_WASTE: Clock,
    ANOMALY: AlertTriangle,
  };

  const Icon = icons[type] || AlertTriangle;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getAnomalyTypeColor(type)}`}>
      <Icon className="w-3 h-3" />
      <span>{getAnomalyTypeLabel(type)}</span>
      {showDetails && score !== undefined && (
        <>
          <span className="text-gray-400 mx-0.5">|</span>
          <span className="opacity-75">{formatPercent(score * 100, 0)}</span>
        </>
      )}
    </div>
  );
}
