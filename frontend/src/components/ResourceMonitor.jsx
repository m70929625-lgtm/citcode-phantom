import { useState, useEffect } from 'react';
import { RefreshCw, Server, Activity, Network, Clock, Search, Database, Boxes, FunctionSquare } from 'lucide-react';
import GlassCard from './GlassCard';
import { getLatestMetrics, getMetricsSummary } from '../hooks/useApi';
import { formatPercent, formatRelativeTime, formatBytes, formatNumber } from '../utils/formatters';

function getResourceIcon(resourceType) {
  if (resourceType === 'RDS') return Database;
  if (resourceType === 'S3') return Boxes;
  if (resourceType === 'Lambda') return FunctionSquare;
  return Server;
}

function getMetricCards(resource, metrics) {
  if (resource.resourceType === 'S3') {
    return [
      {
        label: 'Objects',
        value: formatNumber(metrics.object_count?.value || 0),
        icon: Boxes,
        color: 'text-apple-blue'
      },
      {
        label: 'Storage',
        value: formatBytes(metrics.storage_bytes?.value || 0),
        icon: Database,
        color: 'text-apple-green'
      },
      {
        label: 'Updated',
        value: formatRelativeTime(resource.timestamp),
        icon: Clock,
        color: 'text-apple-purple'
      }
    ];
  }

  if (resource.resourceType === 'RDS') {
    return [
      {
        label: 'CPU',
        value: formatPercent(metrics.cpu_utilization?.value || 0),
        icon: Activity,
        color: 'text-apple-blue'
      },
      {
        label: 'Connections',
        value: formatNumber(metrics.db_connections?.value || 0),
        icon: Network,
        color: 'text-apple-green'
      },
      {
        label: 'Free Storage',
        value: formatBytes(metrics.free_storage_bytes?.value || 0),
        icon: Database,
        color: 'text-apple-purple'
      }
    ];
  }

  if (resource.resourceType === 'Lambda') {
    return [
      {
        label: 'Invocations',
        value: formatNumber(metrics.invocations?.value || 0),
        icon: Activity,
        color: 'text-apple-blue'
      },
      {
        label: 'Errors',
        value: formatNumber(metrics.errors?.value || 0),
        icon: Network,
        color: 'text-apple-green'
      },
      {
        label: 'Duration',
        value: `${formatNumber(metrics.duration_ms?.value || 0, 0)} ms`,
        icon: Clock,
        color: 'text-apple-purple'
      }
    ];
  }

  const networkActivity = (metrics.network_in?.value || 0) + (metrics.network_out?.value || 0);

  return [
    {
      label: 'CPU',
      value: formatPercent(metrics.cpu_utilization?.value || 0),
      icon: Activity,
      color: 'text-apple-blue'
    },
    {
      label: 'Network',
      value: networkActivity > 0 ? 'Active' : 'Idle',
      icon: Network,
      color: 'text-apple-green'
    },
    {
      label: 'Updated',
      value: formatRelativeTime(resource.timestamp),
      icon: Clock,
      color: 'text-apple-purple'
    }
  ];
}

export default function ResourceMonitor() {
  const [resources, setResources] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [latestData, summaryData] = await Promise.all([
        getLatestMetrics(),
        getMetricsSummary('24h')
      ]);

      setResources(latestData.data || []);

      // Index metrics by resource
      const metricsIndex = {};
      for (const r of latestData.data || []) {
        metricsIndex[r.resourceId] = r.metrics;
      }
      setMetrics(metricsIndex);
      setSummary(summaryData);
    } catch (error) {
      console.error('Failed to load resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredResources = resources.filter(r =>
    r.resourceName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.resourceId?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker">Resources</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">Resource Monitor</h2>
          <p className="mt-2 text-base text-apple-gray-500">{resources.length} resources discovered in the selected AWS region.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="toolbar-button disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium">Refresh</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-3">
          <Search className="w-5 h-5 text-apple-gray-400" />
          <input
            type="text"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-apple-gray-800 placeholder:text-apple-gray-400"
          />
        </div>
      </GlassCard>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['EC2', 'S3', 'RDS', 'Lambda'].map((type) => {
            const typeData = summary.data?.find(
              (d) => d.resourceType === type && d.metricType === 'cpu_utilization'
            );
            const resourceCount = resources.filter(r => r.resourceType === type).length;
            return (
              <GlassCard key={type} className="p-4">
                <p className="text-sm text-apple-gray-500">{type}</p>
                <p className="text-2xl font-semibold text-apple-gray-800 mt-1">
                  {resourceCount}
                </p>
                {type === 'EC2' && typeData && (
                  <p className="text-xs text-apple-gray-400 mt-1">
                    Avg: {formatPercent(typeData.avgValue)}
                  </p>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Resource List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-[3px] border-apple-blue/30 border-t-apple-blue rounded-full animate-spin" />
        </div>
      ) : filteredResources.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Server className="w-12 h-12 text-apple-gray-300 mx-auto mb-4" />
          <p className="text-sm text-apple-gray-500">
            {searchQuery ? 'No resources match your search' : 'No resources found in this region'}
          </p>
          <p className="text-xs text-apple-gray-400 mt-1">
            {searchQuery ? 'Try a different search term' : 'Try another AWS region or refresh the latest metrics'}
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredResources.map((resource) => {
            const rMetrics = metrics[resource.resourceId] || {};
            const metricCards = getMetricCards(resource, rMetrics);
            const ResourceIcon = getResourceIcon(resource.resourceType);

            return (
              <GlassCard key={resource.resourceId} hover className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-apple-blue/10 flex items-center justify-center">
                      <ResourceIcon className="w-5 h-5 text-apple-blue" />
                    </div>
                    <div>
                      <p className="font-medium text-apple-gray-800">{resource.resourceName}</p>
                      <p className="text-xs text-apple-gray-400 font-mono">{resource.resourceId.slice(0, 16)}...</p>
                    </div>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-apple-gray-100 text-apple-gray-600">
                    {resource.resourceType}
                  </span>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-3">
                  {metricCards.map((card) => {
                    const CardIcon = card.icon;
                    return (
                      <div key={card.label} className="muted-panel rounded-[20px] p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <CardIcon className={`w-3 h-3 ${card.color}`} />
                          <span className="text-xs text-apple-gray-500">{card.label}</span>
                        </div>
                        <p className="text-sm font-semibold text-apple-gray-800 tabular-nums break-words">
                          {card.value}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
