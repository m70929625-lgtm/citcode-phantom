import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Monitor, AlertTriangle, IndianRupee, Zap, CheckCircle, XCircle, Clock, TrendingUp, Download } from 'lucide-react';
import GlassCard from './GlassCard';
import MetricCard from './MetricCard';
import AnomalyBadge from './AnomalyBadge';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  Legend
} from 'recharts';
import { getAnomalies, getRecommendations, getActionStats, fetchMetrics, getMetrics, getMetricsSummary } from '../hooks/useApi';
import { formatCurrency, formatRelativeTime, formatPercent, formatNumber } from '../utils/formatters';

const LIVE_FETCH_INTERVAL_MS = 60000;
const UI_REFRESH_INTERVAL_MS = 10000;
const USAGE_TREND_WINDOW_MINUTES = 90;
const USAGE_TREND_MAX_POINTS = 90;

function mapWindowToSummaryPeriod(windowValue) {
  if (windowValue === '7d') return '7d';
  if (windowValue === '30d' || windowValue === '90d') return '30d';
  return '24h';
}

function normalizeAnomalyStatus(status) {
  return ['new', 'acknowledged', 'resolved'].includes(status) ? status : 'new';
}

function buildUsageTrend(metrics) {
  const buckets = {};

  for (const metric of metrics) {
    const date = new Date(metric.timestamp);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    date.setSeconds(0, 0);
    const key = date.toISOString();

    if (!buckets[key]) {
      buckets[key] = {
        timestamp: key,
        cpuTotal: 0,
        cpuCount: 0,
        networkBytes: 0
      };
    }

    if (metric.metricType === 'cpu_utilization') {
      buckets[key].cpuTotal += metric.value || 0;
      buckets[key].cpuCount += 1;
    }

    if (metric.metricType === 'network_in' || metric.metricType === 'network_out') {
      buckets[key].networkBytes += metric.value || 0;
    }
  }

  return Object.values(buckets)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .slice(-USAGE_TREND_MAX_POINTS)
    .map((bucket) => ({
      time: new Intl.DateTimeFormat('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(new Date(bucket.timestamp)),
      cpu: bucket.cpuCount ? bucket.cpuTotal / bucket.cpuCount : 0,
      networkMb: bucket.networkBytes / (1024 * 1024)
    }));
}

function buildServiceUsage(summaryRows) {
  const services = {};

  for (const row of summaryRows) {
    if (!services[row.resourceType]) {
      services[row.resourceType] = {
        name: row.resourceType,
        cpuTotal: 0,
        cpuCount: 0,
        resources: new Set()
      };
    }

    services[row.resourceType].resources.add(row.resourceId);

    if (row.metricType === 'cpu_utilization') {
      services[row.resourceType].cpuTotal += row.avgValue || 0;
      services[row.resourceType].cpuCount += 1;
    }
  }

  return Object.values(services)
    .map((service) => ({
      name: service.name,
      avgCpu: service.cpuCount ? service.cpuTotal / service.cpuCount : 0,
      resources: service.resources.size
    }))
    .sort((a, b) => b.resources - a.resources);
}

export default function Dashboard({ status, onRefresh, filters = {} }) {
  const [loading, setLoading] = useState(false);
  const [anomalies, setAnomalies] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [actionStats, setActionStats] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [usageTrend, setUsageTrend] = useState([]);
  const [serviceUsage, setServiceUsage] = useState([]);
  const refreshInProgressRef = useRef(false);

  const loadDashboardData = useCallback(async () => {
    try {
      const startDate = new Date(Date.now() - (USAGE_TREND_WINDOW_MINUTES * 60 * 1000)).toISOString();
      const anomalyStatus = normalizeAnomalyStatus(filters.status);
      const summaryPeriod = mapWindowToSummaryPeriod(filters.window);

      const [anomaliesData, recsData, actionsData, metricsData, summaryData] = await Promise.all([
        getAnomalies({ status: anomalyStatus, limit: 5 }),
        getRecommendations(),
        getActionStats(),
        getMetrics({ startDate, limit: 5000 }),
        getMetricsSummary(summaryPeriod)
      ]);

      const serviceFilteredAnomalies = (anomaliesData.data || []).filter((anomaly) => {
        if (!filters.service || filters.service === 'all') {
          return true;
        }
        return anomaly.resourceType === filters.service;
      });

      setAnomalies(serviceFilteredAnomalies);
      setRecommendations(recsData.data || []);
      setActionStats(actionsData);
      setRecentActivity(actionsData.recentActivity || []);
      setUsageTrend(buildUsageTrend(metricsData.data || []));
      const usageRows = buildServiceUsage(summaryData.data || []);
      const filteredUsageRows = usageRows.filter((row) => {
        if (!filters.service || filters.service === 'all') {
          return true;
        }
        return row.name === filters.service;
      });
      setServiceUsage(filteredUsageRows);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  }, [filters.service, filters.status, filters.window]);

  const refreshView = useCallback(async (showLoader = false) => {
    if (refreshInProgressRef.current) {
      return;
    }

    refreshInProgressRef.current = true;

    if (showLoader) {
      setLoading(true);
    }

    try {
      await loadDashboardData();
      await onRefresh?.();
    } catch (error) {
      console.error('Failed to refresh dashboard view:', error);
    } finally {
      if (showLoader) {
        setLoading(false);
      }
      refreshInProgressRef.current = false;
    }
  }, [loadDashboardData, onRefresh]);

  const refreshFromAws = useCallback(async (showLoader = false) => {
    if (refreshInProgressRef.current) {
      return;
    }

    refreshInProgressRef.current = true;

    if (showLoader) {
      setLoading(true);
    }

    try {
      try {
        await fetchMetrics();
      } catch (error) {
        console.error('Failed to fetch live AWS metrics:', error);
      }

      await loadDashboardData();
      await onRefresh?.();
    } catch (error) {
      console.error('Failed to auto-refresh dashboard:', error);
    } finally {
      if (showLoader) {
        setLoading(false);
      }
      refreshInProgressRef.current = false;
    }
  }, [loadDashboardData, onRefresh]);

  useEffect(() => {
    refreshFromAws(false);
  }, [refreshFromAws]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshFromAws(false);
    }, LIVE_FETCH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refreshFromAws]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshView(false);
    }, UI_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refreshView]);

  const handleRefresh = async () => {
    await refreshFromAws(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker">Overview</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">System Overview</h2>
          <p className="mt-2 text-base text-apple-gray-500">Live summary of AWS connectivity, anomalies, savings and recent actions.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="toolbar-button disabled:opacity-50 bg-apple-blue/10 hover:bg-apple-blue/20"
            title="Fetch live AWS data from cloud"
          >
            <Download className={`w-4 h-4 text-apple-blue ${loading ? 'animate-pulse' : ''}`} />
            <span className="text-sm font-medium text-apple-blue">
              {loading ? 'Fetching...' : 'Fetch Live AWS Data'}
            </span>
          </button>
          <button
            onClick={() => refreshView(true)}
            disabled={loading}
            className="toolbar-button disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium">Refresh View</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Resources"
          value={status?.resources?.EC2 || 0}
          unit="instances"
          icon={Monitor}
          color="blue"
          changeLabel="EC2 instances monitored"
        />
        <MetricCard
          title="Anomalies Detected"
          value={status?.recentAnomalies || 0}
          unit="last 24h"
          icon={AlertTriangle}
          color="orange"
        />
        <MetricCard
          title="Total Savings"
          value={actionStats ? formatCurrency(actionStats.totalSavings) : formatCurrency(0)}
          icon={IndianRupee}
          color="green"
          changeLabel="from executed actions"
        />
        <MetricCard
          title="Actions Taken"
          value={actionStats?.byStatus?.executed || 0}
          icon={Zap}
          color="purple"
          changeLabel={`${actionStats?.byStatus?.pending || 0} pending`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <GlassCard className="xl:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-apple-gray-800">Usage Trend</h3>
              <p className="text-sm text-apple-gray-500 mt-1">Minute-level CPU and network activity (auto-updates every few seconds).</p>
            </div>
          </div>

          {usageTrend.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-apple-gray-400">
              No usage trend data available yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={usageTrend}>
                <defs>
                  <linearGradient id="cpuUsageGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0071e3" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0071e3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" />
                <XAxis dataKey="time" stroke="#86868b" fontSize={12} />
                <YAxis
                  yAxisId="cpu"
                  stroke="#86868b"
                  fontSize={12}
                  tickFormatter={(value) => `${Math.round(value)}%`}
                />
                <YAxis
                  yAxisId="network"
                  orientation="right"
                  stroke="#86868b"
                  fontSize={12}
                  tickFormatter={(value) => `${formatNumber(value, 0)} MB`}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'CPU') {
                      return [formatPercent(value), 'CPU'];
                    }

                    return [`${formatNumber(value, 2)} MB`, 'Network'];
                  }}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #e8e8ed',
                    borderRadius: '12px',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
                  }}
                />
                <Legend />
                <Area
                  yAxisId="cpu"
                  type="monotone"
                  dataKey="cpu"
                  name="CPU"
                  stroke="#0071e3"
                  strokeWidth={2}
                  fill="url(#cpuUsageGradient)"
                />
                <Area
                  yAxisId="network"
                  type="monotone"
                  dataKey="networkMb"
                  name="Network"
                  stroke="#34c759"
                  strokeWidth={2}
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-apple-gray-800">Usage by Service</h3>
              <p className="text-sm text-apple-gray-500 mt-1">Average CPU load and tracked resource count by AWS service.</p>
            </div>
          </div>

          {serviceUsage.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-apple-gray-400">
              No service usage data available yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={serviceUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" />
                <XAxis dataKey="name" stroke="#86868b" fontSize={12} />
                <YAxis
                  yAxisId="cpu"
                  stroke="#86868b"
                  fontSize={12}
                  tickFormatter={(value) => `${Math.round(value)}%`}
                />
                <YAxis
                  yAxisId="resources"
                  orientation="right"
                  stroke="#86868b"
                  fontSize={12}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'Avg CPU') {
                      return [formatPercent(value), 'Average CPU'];
                    }

                    return [formatNumber(value, 0), 'Resources'];
                  }}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #e8e8ed',
                    borderRadius: '12px',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
                  }}
                />
                <Legend />
                <Bar yAxisId="cpu" dataKey="avgCpu" name="Avg CPU" fill="#0071e3" radius={[8, 8, 0, 0]} />
                <Bar yAxisId="resources" dataKey="resources" name="Resources" fill="#ff9500" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Anomalies Panel */}
        <GlassCard className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-apple-gray-800">Recent Anomalies</h3>
            {anomalies.length > 0 && (
              <span className="text-xs text-apple-gray-400">{anomalies.length} new</span>
            )}
          </div>

          {anomalies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-apple-green/10 flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-apple-green" />
              </div>
              <p className="text-sm font-medium text-apple-gray-600">All Clear</p>
              <p className="text-xs text-apple-gray-400 mt-1">No anomalies detected in your cloud resources</p>
            </div>
          ) : (
            <div className="space-y-3">
              {anomalies.map((anomaly) => (
                <div
                  key={anomaly.id}
                  className="muted-panel flex items-center justify-between rounded-[24px] p-4 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-apple-orange/10 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-apple-orange" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-apple-gray-800">{anomaly.resourceName}</span>
                        <AnomalyBadge type={anomaly.type} />
                      </div>
                      <p className="text-xs text-apple-gray-500 mt-0.5">
                        {anomaly.resourceType} &middot; Score: {(anomaly.score * 100).toFixed(0)}% &middot; {formatRelativeTime(anomaly.detectedAt)}
                      </p>
                    </div>
                  </div>
                  {anomaly.estimatedSavings > 0 && (
                    <div className="text-right">
                      <p className="text-sm font-semibold text-apple-green">{formatCurrency(anomaly.estimatedSavings)}/mo</p>
                      <p className="text-xs text-apple-gray-400">potential savings</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Quick Actions Panel */}
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold text-apple-gray-800 mb-4">Quick Stats</h3>

          <div className="space-y-4">
            <div className="muted-panel rounded-[24px] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-apple-gray-600">System Status</span>
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${status?.awsConnected ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${status?.awsConnected ? 'bg-apple-green' : 'bg-apple-red'}`} />
                  {status?.awsConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
              <p className="text-xs text-apple-gray-400">AWS {status?.awsRegion || 'us-east-1'}</p>
            </div>

            <div className="muted-panel rounded-[24px] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-apple-gray-600">Dry Run Mode</span>
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${status?.dryRunMode ? 'bg-blue-100 text-blue-700' : 'bg-apple-green/10 text-apple-green'}`}>
                  {status?.dryRunMode ? 'Enabled' : 'Disabled'}
                </div>
              </div>
              <p className="text-xs text-apple-gray-400">
                {status?.automationLevel === 'auto'
                  ? 'Automatic execution enabled'
                  : status?.automationLevel === 'suggest'
                    ? 'Recommendations only'
                    : 'Actions require approval'}
              </p>
            </div>

            <div className="muted-panel rounded-[24px] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-apple-gray-600">ML Model</span>
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                  status?.mlModelLoaded ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-orange/10 text-apple-orange'
                }`}>
                  <CheckCircle className="w-3 h-3" />
                  {status?.mlModelLoaded ? 'Loaded' : 'Fallback'}
                </div>
              </div>
              <p className="text-xs text-apple-gray-400">
                {status?.mlModelLoaded ? 'Isolation Forest v1.0' : 'Statistical detection active'}
              </p>
            </div>

            <div className="muted-panel rounded-[24px] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-apple-gray-600">Last Collection</span>
              </div>
              <p className="text-xs text-apple-gray-500">
                {status?.lastFetchAt ? formatRelativeTime(status.lastFetchAt) : 'Never'}
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Recommendations Section */}
      {recommendations.length > 0 && (
        <GlassCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-apple-blue" />
            <h3 className="text-lg font-semibold text-apple-gray-800">Cost Optimization Recommendations</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recommendations.slice(0, 6).map((rec) => (
              <div
                key={rec.id}
                className="p-4 rounded-xl bg-gradient-to-br from-apple-blue/5 to-apple-purple/5 border border-apple-blue/20 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${rec.type === 'STOP_IDLE' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {rec.type === 'STOP_IDLE' ? 'Stop Idle' : 'Optimize'}
                  </span>
                  <span className="text-sm font-semibold text-apple-green">{formatCurrency(rec.monthlySavings)}/mo</span>
                </div>
                <p className="text-sm font-medium text-apple-gray-800">{rec.resourceName}</p>
                <p className="text-xs text-apple-gray-500 mt-1">{rec.reason}</p>
                <p className="text-xs text-apple-gray-400 mt-2">Confidence: {(rec.confidence * 100).toFixed(0)}%</p>
              </div>
            ))}
          </div>

          {recommendations.length > 6 && (
            <p className="text-center text-sm text-apple-gray-500 mt-4">
              +{recommendations.length - 6} more recommendations
            </p>
          )}
        </GlassCard>
      )}

      {/* Recent Activity */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold text-apple-gray-800 mb-4">Recent Activity</h3>

        {recentActivity.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="w-10 h-10 text-apple-gray-300 mx-auto mb-3" />
            <p className="text-sm text-apple-gray-500">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentActivity.map((action) => (
              <div key={action.id} className="muted-panel flex items-center gap-3 rounded-[24px] p-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  action.status === 'executed' ? 'bg-apple-green/10 text-apple-green' :
                  action.status === 'dismissed' ? 'bg-gray-200 text-gray-500' :
                  action.status === 'failed' ? 'bg-apple-red/10 text-apple-red' :
                  'bg-apple-orange/10 text-apple-orange'
                }`}>
                  {action.status === 'executed' ? <CheckCircle className="w-4 h-4" /> :
                   action.status === 'dismissed' ? <XCircle className="w-4 h-4" /> :
                   action.status === 'failed' ? <XCircle className="w-4 h-4" /> :
                   <Clock className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-apple-gray-800 truncate">{action.resourceName}</p>
                  <p className="text-xs text-apple-gray-500">{action.actionType.replace('_', ' ')}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    action.status === 'executed' ? 'bg-apple-green/10 text-apple-green' :
                    action.status === 'dismissed' ? 'bg-gray-200 text-gray-600' :
                    action.status === 'pending' ? 'bg-apple-orange/10 text-apple-orange' :
                    'bg-apple-red/10 text-apple-red'
                  }`}>
                    {action.status}
                  </span>
                  {action.savings > 0 && action.status === 'executed' && (
                    <p className="text-xs text-apple-green mt-1">{formatCurrency(action.savings)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
