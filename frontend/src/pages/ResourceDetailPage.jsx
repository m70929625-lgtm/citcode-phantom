import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Cpu, Network, Clock3, Server } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import { getActions, getMetrics } from '../hooks/useApi';
import { formatPercent, formatRelativeTime, formatBytes, formatNumber } from '../utils/formatters';

function toMetricMap(rows) {
  const map = {};
  for (const row of rows) {
    map[row.metricType] = row;
  }
  return map;
}

export default function ResourceDetailPage() {
  const { resourceId } = useParams();
  const [metrics, setMetrics] = useState([]);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const startDate = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
        const [metricsResponse, actionResponse] = await Promise.all([
          getMetrics({ resourceId, startDate, limit: 800 }),
          getActions({ resourceId, limit: 20 })
        ]);
        setMetrics(metricsResponse.data || []);
        setActions(actionResponse.data || []);
      } catch (error) {
        console.error('Failed to load resource detail:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [resourceId]);

  const latestMetrics = useMemo(() => {
    const latestRows = [];
    const seen = new Set();
    for (const metric of metrics) {
      if (!seen.has(metric.metricType)) {
        latestRows.push(metric);
        seen.add(metric.metricType);
      }
    }
    return toMetricMap(latestRows);
  }, [metrics]);

  const resourceName = metrics[0]?.resourceName || actions[0]?.resourceName || resourceId;
  const resourceType = metrics[0]?.resourceType || actions[0]?.resourceType || 'Resource';
  const lastSeen = metrics[0]?.timestamp;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/resources" className="mb-3 inline-flex items-center gap-2 text-sm text-apple-gray-500 hover:text-apple-gray-700">
            <ArrowLeft className="h-4 w-4" />
            Back to Resources
          </Link>
          <p className="section-kicker">Resource Detail</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">{resourceName}</h2>
          <p className="mt-2 text-sm text-apple-gray-500">
            {resourceType} · {resourceId}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-apple-blue/30 border-t-apple-blue" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 text-apple-gray-500"><Cpu className="h-4 w-4" /> CPU</div>
              <p className="mt-2 text-2xl font-semibold text-apple-gray-800">{formatPercent(latestMetrics.cpu_utilization?.value || 0)}</p>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 text-apple-gray-500"><Network className="h-4 w-4" /> Network In</div>
              <p className="mt-2 text-2xl font-semibold text-apple-gray-800">{formatBytes(latestMetrics.network_in?.value || 0)}</p>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 text-apple-gray-500"><Server className="h-4 w-4" /> Network Out</div>
              <p className="mt-2 text-2xl font-semibold text-apple-gray-800">{formatBytes(latestMetrics.network_out?.value || 0)}</p>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 text-apple-gray-500"><Clock3 className="h-4 w-4" /> Last updated</div>
              <p className="mt-2 text-2xl font-semibold text-apple-gray-800">{lastSeen ? formatRelativeTime(lastSeen) : 'N/A'}</p>
            </GlassCard>
          </div>

          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-apple-gray-800">Recent Action History</h3>
            {actions.length === 0 ? (
              <p className="mt-3 text-sm text-apple-gray-500">No actions for this resource yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {actions.map((action) => (
                  <div key={action.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/80 bg-white/65 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-apple-gray-800">{action.actionType?.replace('_', ' ')}</p>
                      <p className="text-xs text-apple-gray-500">{formatRelativeTime(action.createdAt)} · {action.status}</p>
                    </div>
                    <p className="text-sm font-medium text-apple-green">{formatNumber(action.savings || 0, 2)}</p>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
