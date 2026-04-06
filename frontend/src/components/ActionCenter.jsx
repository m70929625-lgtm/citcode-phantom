import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Zap, CheckCircle, XCircle, Clock, Play, Shield, Bell, AlertTriangle } from 'lucide-react';
import GlassCard from './GlassCard';
import { getActions, getActionStats, approveAction, executeAction, dismissAction, getStatus } from '../hooks/useApi';
import { formatRelativeTime, formatCurrency } from '../utils/formatters';

function normalizeActionStatus(status) {
  if (status === 'all') return 'all';
  if (['pending', 'approved', 'executed', 'dismissed', 'failed'].includes(status)) return status;
  return null;
}

export default function ActionCenter({ filters = {} }) {
  const [actions, setActions] = useState([]);
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [filter, setFilter] = useState(normalizeActionStatus(filters.status) || 'pending');

  useEffect(() => {
    const nextGlobalStatus = normalizeActionStatus(filters.status);
    if (nextGlobalStatus && nextGlobalStatus !== filter) {
      setFilter(nextGlobalStatus);
    }
  }, [filters.status]);

  useEffect(() => {
    loadData();
  }, [filter, filters.service]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [actionsData, statsData, statusData] = await Promise.all([
        getActions(filter === 'all' ? {} : { status: filter }),
        getActionStats(),
        getStatus()
      ]);

      const filteredActions = (actionsData.data || []).filter((action) => {
        if (!filters.service || filters.service === 'all') {
          return true;
        }
        return action.resourceId?.toLowerCase().includes(filters.service.toLowerCase())
          || action.resourceName?.toLowerCase().includes(filters.service.toLowerCase())
          || action.actionType?.toLowerCase().includes(filters.service.toLowerCase());
      });

      setActions(filteredActions);
      setStats(statsData);
      setStatus(statusData);
    } catch (error) {
      console.error('Failed to load actions:', error);
    } finally {
      setLoading(false);
    }
  };

  const executionTitle = status?.dryRunMode
    ? 'Dry run enabled'
    : status?.automationLevel === 'auto'
      ? 'Automatic execution enabled'
      : status?.automationLevel === 'suggest'
        ? 'Recommendation mode enabled'
        : 'Approval mode enabled';

  const executionDescription = status?.dryRunMode
    ? 'Actions can be reviewed and executed from the app, but dry run keeps AWS changes from being applied.'
    : status?.automationLevel === 'auto'
      ? 'Supported actions may be approved and executed automatically when new anomalies are created.'
      : status?.automationLevel === 'suggest'
        ? 'The system only suggests actions. Nothing is approved or executed automatically.'
        : 'Actions stay pending until you approve them and then choose to execute them.';

  const handleApprove = async (id) => {
    setActionLoading(id);
    try {
      await approveAction(id);
      await loadData();
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecute = async (id) => {
    setActionLoading(id);
    try {
      await executeAction(id);
      await loadData();
    } catch (error) {
      console.error('Failed to execute:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDismiss = async (id) => {
    setActionLoading(id);
    try {
      await dismissAction(id);
      await loadData();
    } catch (error) {
      console.error('Failed to dismiss:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const getActionIcon = (type) => {
    switch (type) {
      case 'STOP_INSTANCE':
        return <Zap className="w-5 h-5 text-apple-red" />;
      case 'START_INSTANCE':
        return <Play className="w-5 h-5 text-apple-green" />;
      case 'SEND_ALERT':
        return <AlertTriangle className="w-5 h-5 text-apple-orange" />;
      default:
        return <Bell className="w-5 h-5 text-apple-blue" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker">Actions</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">Action Center</h2>
          <p className="mt-2 text-base text-apple-gray-500">Approve, dismiss or execute cost-control actions created from detected issues.</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="toolbar-button disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">Refresh</span>
        </button>
      </div>

      {/* Safety Notice */}
      <GlassCard className="p-4 border-apple-blue/30 bg-apple-blue/5">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-apple-blue" />
          <div>
            <p className="text-sm font-medium text-apple-gray-800">{executionTitle}</p>
            <p className="text-xs text-apple-gray-500">{executionDescription}</p>
          </div>
        </div>
      </GlassCard>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GlassCard className="p-4 text-center">
            <p className="text-2xl font-bold text-apple-gray-800">{stats.total || 0}</p>
            <p className="text-xs text-apple-gray-500">Total Actions</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <p className="text-2xl font-bold text-apple-orange">{stats.byStatus?.pending || 0}</p>
            <p className="text-xs text-apple-gray-500">Pending</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <p className="text-2xl font-bold text-apple-green">{stats.byStatus?.executed || 0}</p>
            <p className="text-xs text-apple-gray-500">Executed</p>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <p className="text-2xl font-bold text-apple-green">{formatCurrency(stats.totalSavings || 0, 'INR', 0)}</p>
            <p className="text-xs text-apple-gray-500">Total Savings</p>
          </GlassCard>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {['pending', 'approved', 'executed', 'dismissed', 'all'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`
              px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize
              ${filter === f
                ? 'bg-apple-blue text-white shadow-sm'
                : 'bg-white shadow-sm border border-white/80 text-apple-gray-600 hover:bg-gray-50'
              }
            `}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Actions List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-[3px] border-apple-blue/30 border-t-apple-blue rounded-full animate-spin" />
        </div>
      ) : actions.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-apple-gray-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-apple-gray-400" />
          </div>
          <p className="text-lg font-medium text-apple-gray-600">No {filter} actions</p>
          <p className="text-sm text-apple-gray-400 mt-1">
            {filter === 'pending' ? 'All actions have been processed' : `No ${filter} actions found`}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {actions.map((action) => (
            <GlassCard key={action.id} className="p-5">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                  {getActionIcon(action.actionType)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Link to={`/actions/${encodeURIComponent(action.id)}`} className="font-semibold text-apple-gray-800 hover:text-apple-blue">
                          {action.resourceName}
                        </Link>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-apple-gray-100 text-apple-gray-600">
                          {action.actionType.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-apple-gray-500 font-mono">{action.resourceId}</p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      {action.savings > 0 && (
                        <div className="text-lg font-bold text-apple-green">{formatCurrency(action.savings)}</div>
                      )}
                      <div className="text-xs text-apple-gray-400">potential savings/mo</div>
                    </div>
                  </div>

                  {/* Info Row */}
                  <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
                    {action.anomalyType && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-apple-gray-400 font-semibold">Reason</p>
                        <p className="text-xs text-apple-gray-600 font-medium">{action.anomalyType.replace('_', ' ')}</p>
                      </div>
                    )}
                    {action.status === 'executed' && action.result && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-apple-gray-400 font-semibold">Result</p>
                        <p className="text-xs text-apple-green font-medium">
                          {action.result.message || 'Action completed successfully'}
                          {action.result.notificationType === 'COST_ANOMALY' && ' - Cost anomaly alert sent'}
                        </p>
                      </div>
                    )}
                    {action.actionType === 'SEND_ALERT' && action.anomalyType?.includes('COST') && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-apple-gray-400 font-semibold">Action Taken</p>
                        <p className="text-xs text-apple-orange font-medium">
                          Automatically notified about cost spike. Review Cost Trends for details.
                        </p>
                      </div>
                    )}
                    {action.status === 'failed' && action.error && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-apple-gray-400 font-semibold">Error</p>
                        <p className="text-xs text-apple-red font-medium">{action.error}</p>
                      </div>
                    )}
                  </div>

                  {/* Dry Run Badge */}
                  {action.dryRun && (
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium mt-2">
                      <Clock className="w-3 h-3" />
                      Dry Run Mode
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-4">
                    {action.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(action.id)}
                          disabled={actionLoading === action.id}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-apple-blue text-white hover:bg-apple-blueHover transition-colors disabled:opacity-50"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleDismiss(action.id)}
                          disabled={actionLoading === action.id}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-apple-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          Dismiss
                        </button>
                      </>
                    )}

                    {action.status === 'approved' && (
                      <button
                        onClick={() => handleExecute(action.id)}
                        disabled={actionLoading === action.id}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-apple-green text-white hover:bg-apple-green/90 transition-colors disabled:opacity-50"
                      >
                        <Play className="w-4 h-4" />
                        Execute
                      </button>
                    )}

                    {action.status === 'executed' && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-apple-green/10 text-apple-green">
                        <CheckCircle className="w-4 h-4" />
                        Executed {formatRelativeTime(action.executedAt)}
                      </div>
                    )}

                    {action.status === 'dismissed' && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-apple-gray-500">
                        <XCircle className="w-4 h-4" />
                        Dismissed
                      </div>
                    )}

                    {action.status === 'failed' && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-apple-red/10 text-apple-red">
                        <XCircle className="w-4 h-4" />
                        Failed
                      </div>
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
