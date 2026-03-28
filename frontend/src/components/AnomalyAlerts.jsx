import { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, Filter, Bell, Check, X } from 'lucide-react';
import GlassCard from './GlassCard';
import AnomalyBadge from './AnomalyBadge';
import { getAnomalies, updateAnomaly } from '../hooks/useApi';
import { formatRelativeTime, formatCurrency, formatPercent } from '../utils/formatters';

export default function AnomalyAlerts() {
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selectedAnomaly, setSelectedAnomaly] = useState(null);

  useEffect(() => {
    loadAnomalies();
  }, [filter]);

  const loadAnomalies = async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? { status: filter } : {};
      const data = await getAnomalies(params);
      setAnomalies(data.data || []);
    } catch (error) {
      console.error('Failed to load anomalies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (id) => {
    try {
      await updateAnomaly(id, 'acknowledged');
      await loadAnomalies();
    } catch (error) {
      console.error('Failed to acknowledge:', error);
    }
  };

  const handleResolve = async (id) => {
    try {
      await updateAnomaly(id, 'resolved');
      await loadAnomalies();
    } catch (error) {
      console.error('Failed to resolve:', error);
    }
  };

  const filterOptions = [
    { value: 'all', label: 'All', count: anomalies.length },
    { value: 'new', label: 'New' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker">Anomalies</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">Anomaly Alerts</h2>
          <p className="mt-2 text-base text-apple-gray-500">Review detected anomalies, their severity and the recommended next step.</p>
        </div>
        <button
          onClick={loadAnomalies}
          disabled={loading}
          className="toolbar-button disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          <Filter className="w-4 h-4 text-apple-gray-400" />
          {filterOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setFilter(option.value)}
              className={`
                px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                ${filter === option.value
                  ? 'bg-apple-blue text-white shadow-sm'
                  : 'bg-gray-100 text-apple-gray-600 hover:bg-gray-200'
                }
              `}
            >
              {option.label}
              {option.count !== undefined && ` (${option.count})`}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Anomaly List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-[3px] border-apple-blue/30 border-t-apple-blue rounded-full animate-spin" />
        </div>
      ) : anomalies.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-apple-green/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-apple-green" />
          </div>
          <p className="text-lg font-medium text-apple-gray-700">No anomalies detected</p>
          <p className="text-sm text-apple-gray-400 mt-1">
            {filter !== 'all' ? `No ${filter} anomalies` : 'Your cloud resources are operating normally'}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {anomalies.map((anomaly) => (
            <GlassCard key={anomaly.id} hover className="p-5">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className={`
                  w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0
                  ${anomaly.score >= 0.7 ? 'bg-apple-red/10' :
                    anomaly.score >= 0.5 ? 'bg-apple-orange/10' : 'bg-yellow-50'}
                `}>
                  <AlertTriangle className={`w-6 h-6 ${
                    anomaly.score >= 0.7 ? 'text-apple-red' :
                    anomaly.score >= 0.5 ? 'text-apple-orange' : 'text-yellow-600'
                  }`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-apple-gray-800">{anomaly.resourceName}</span>
                        <AnomalyBadge type={anomaly.type} />
                      </div>
                      <p className="text-sm text-apple-gray-500">
                        {anomaly.resourceType} &middot; {anomaly.resourceId.slice(0, 16)}...
                      </p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="text-2xl font-bold text-apple-gray-800 tabular-nums">
                        {formatPercent(anomaly.score * 100, 0)}
                      </div>
                      <div className="text-xs text-apple-gray-400">anomaly score</div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-3 gap-4 mt-4 p-3 rounded-xl bg-gray-50/80">
                    <div>
                      <p className="text-xs text-apple-gray-400">Confidence</p>
                      <p className="text-sm font-semibold text-apple-gray-700">{formatPercent(anomaly.confidence * 100, 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-apple-gray-400">Recommended Action</p>
                      <p className="text-sm font-semibold text-apple-blue">{anomaly.recommendedAction?.replace('_', ' ')}</p>
                    </div>
                    {anomaly.estimatedSavings > 0 && (
                      <div>
                        <p className="text-xs text-apple-gray-400">Potential Savings</p>
                        <p className="text-sm font-semibold text-apple-green">{formatCurrency(anomaly.estimatedSavings)}/mo</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between mt-4">
                    <div className="flex items-center gap-2 text-xs text-apple-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>Detected {formatRelativeTime(anomaly.detectedAt)}</span>
                    </div>

                    {anomaly.status === 'new' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAcknowledge(anomaly.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-apple-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          <Check className="w-3 h-3" />
                          Acknowledge
                        </button>
                        <button
                          onClick={() => handleResolve(anomaly.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apple-green/10 text-apple-green hover:bg-apple-green/20 transition-colors"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Resolve
                        </button>
                      </div>
                    )}

                    {anomaly.status === 'acknowledged' && (
                      <button
                        onClick={() => handleResolve(anomaly.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-apple-green/10 text-apple-green hover:bg-apple-green/20 transition-colors"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Mark Resolved
                      </button>
                    )}

                    {anomaly.status === 'resolved' && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-apple-green">
                        <CheckCircle className="w-3 h-3" />
                        Resolved
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
