import { useState, useEffect } from 'react';
import { RefreshCw, IndianRupee, TrendingUp, PieChart, AlertTriangle, ScanLine, CheckCircle } from 'lucide-react';
import GlassCard from './GlassCard';
import { AreaChart, Area, PieChart as RechartsPie, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getCosts, detectCostAnomalies } from '../hooks/useApi';
import { formatCurrency, formatDateShort } from '../utils/formatters';

const COLORS = ['#0071e3', '#34c759', '#ff9500', '#ff3b30', '#5856d6', '#af52de'];

export default function CostTrends() {
  const [costData, setCostData] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detectingAnomalies, setDetectingAnomalies] = useState(false);
  const [detectionResult, setDetectionResult] = useState(null);

  useEffect(() => {
    loadCostData();
  }, [period]);

  const loadCostData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCosts(period);
      setCostData(data);
    } catch (error) {
      console.error('Failed to load cost data:', error);
      setError(error.message || 'Failed to load live AWS cost data');
    } finally {
      setLoading(false);
    }
  };

  const handleDetectAnomalies = async () => {
    setDetectingAnomalies(true);
    setDetectionResult(null);
    try {
      const result = await detectCostAnomalies();
      setDetectionResult(result);
      // Refresh cost data to show updated anomalies
      await loadCostData();
    } catch (error) {
      console.error('Failed to detect anomalies:', error);
      setDetectionResult({ error: error.message });
    } finally {
      setDetectingAnomalies(false);
    }
  };

  const periodOptions = [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
  ];

  const formatDisplayCost = (amount, decimals = 2) => {
    if (!costData) return formatCurrency(amount, 'INR', decimals);

    if (costData.displayCurrency === 'INR' && costData.sourceCurrency === 'USD') {
      return formatCurrency(amount, 'INR', decimals, { convertFromUsd: true });
    }

    return formatCurrency(amount, costData.displayCurrency || costData.sourceCurrency || 'INR', decimals, {
      convertFromUsd: false
    });
  };

  const pieData = (costData?.serviceBreakdown || [])
    .slice(0, 5)
    .map((service) => ({
      name: service.serviceName,
      value: service.amount
    }))
    .filter((entry) => entry.value > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker">Costs</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">Cost Analysis</h2>
          <p className="mt-2 text-base text-apple-gray-500">
            Review live AWS billing data, daily trends and service-level breakdown for the selected period.
          </p>
          {costData?.source === 'aws_cost_explorer' && (
            <p className="mt-2 text-sm text-apple-gray-400">
              {costData.displayCurrency !== costData.sourceCurrency
                ? `Showing approximate INR values converted from AWS Cost Explorer ${costData.sourceCurrency} billing data.`
                : `Showing live AWS Cost Explorer values in ${costData.sourceCurrency}.`}
            </p>
          )}
          {costData?.source === 'resource_count_heuristic' && (
            <div className="mt-2 space-y-1 text-sm text-apple-gray-400">
              <p>
                Showing estimated values based on tracked AWS resources because live Cost Explorer access is not available yet.
              </p>
              {costData.fallbackReason && (
                <p>
                  AWS response: {costData.fallbackReason}. Enable Cost Explorer and allow <span className="font-mono">ce:GetCostAndUsage</span> to switch this section to live billing data.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white shadow-sm border border-white/80">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setPeriod(option.value)}
                className={`
                  px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                  ${period === option.value
                    ? 'bg-apple-blue text-white shadow-sm'
                    : 'text-apple-gray-600 hover:text-apple-gray-800'
                  }
                `}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleDetectAnomalies}
            disabled={detectingAnomalies}
            className="toolbar-button disabled:opacity-50 bg-apple-orange/10 hover:bg-apple-orange/20"
            title="Scan for cost spikes and anomalies"
          >
            <ScanLine className={`w-4 h-4 text-apple-orange ${detectingAnomalies ? 'animate-pulse' : ''}`} />
            <span className="text-sm font-medium text-apple-orange">
              {detectingAnomalies ? 'Scanning...' : 'Detect Anomalies'}
            </span>
          </button>
          <button
            onClick={loadCostData}
            disabled={loading}
            className="toolbar-button disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium">Refresh</span>
          </button>
        </div>
      </div>

      {/* Detection Result Notification */}
      {detectionResult && (
        <GlassCard className={`p-4 ${detectionResult.error ? 'border-apple-red/30 bg-apple-red/5' : detectionResult.detected > 0 ? 'border-apple-orange/30 bg-apple-orange/5' : 'border-apple-green/30 bg-apple-green/5'}`}>
          <div className="flex items-center gap-3">
            {detectionResult.error ? (
              <AlertTriangle className="w-5 h-5 text-apple-red" />
            ) : detectionResult.detected > 0 ? (
              <AlertTriangle className="w-5 h-5 text-apple-orange" />
            ) : (
              <CheckCircle className="w-5 h-5 text-apple-green" />
            )}
            <div>
              <p className="text-sm font-medium text-apple-gray-800">
                {detectionResult.error 
                  ? 'Detection Failed' 
                  : detectionResult.detected > 0 
                    ? `${detectionResult.detected} Cost Anomaly${detectionResult.detected > 1 ? 'ies' : 'y'} Detected` 
                    : 'No Cost Anomalies Found'}
              </p>
              <p className="text-xs text-apple-gray-500">
                {detectionResult.error 
                  ? detectionResult.error 
                  : detectionResult.detected > 0 
                    ? `Actions created for: ${detectionResult.anomalies.map(a => a.resourceName).join(', ')}. Check Action Center.` 
                    : 'Cost data looks normal. No automatic actions taken.'}
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-[3px] border-apple-blue/30 border-t-apple-blue rounded-full animate-spin" />
        </div>
      ) : error ? (
        <GlassCard className="p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-apple-orange mx-auto mb-4" />
          <p className="text-sm font-medium text-apple-gray-700">Cost data is unavailable</p>
          <p className="text-sm text-apple-gray-500 mt-2">{error}</p>
        </GlassCard>
      ) : costData ? (
        <>
          {/* Cost Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-apple-blue/10 flex items-center justify-center">
                  <IndianRupee className="w-5 h-5 text-apple-blue" />
                </div>
                <span className="text-sm text-apple-gray-500">Total {period.replace('d', ' days')}</span>
              </div>
              <p className="text-3xl font-bold text-apple-gray-800 tabular-nums">
                {formatDisplayCost(costData.totalCost)}
              </p>
              <p className="text-sm text-apple-gray-400 mt-1">projected monthly: {formatDisplayCost(costData.projectedMonthly)}</p>
            </GlassCard>

            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-apple-green/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-apple-green" />
                </div>
                <span className="text-sm text-apple-gray-500">Daily Average</span>
              </div>
              <p className="text-3xl font-bold text-apple-gray-800 tabular-nums">
                {formatDisplayCost(costData.totalCost / parseInt(period, 10) || 0)}
              </p>
              <p className="text-sm text-apple-gray-400 mt-1">cost per day</p>
            </GlassCard>

            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-apple-orange/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-apple-orange" />
                </div>
                <span className="text-sm text-apple-gray-500">Cost Anomalies</span>
              </div>
              <p className="text-3xl font-bold text-apple-gray-800 tabular-nums">
                {costData.anomalies?.totalAnomalies || 0}
              </p>
              <p className="text-sm text-apple-gray-400 mt-1">{costData.anomalies?.highCostDays?.length || 0} high cost days</p>
            </GlassCard>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Cost Trend */}
            <GlassCard className="lg:col-span-2 p-6">
              <h3 className="text-lg font-semibold text-apple-gray-800 mb-4">Cost Trend</h3>
              {costData.trends && costData.trends.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={costData.trends}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0071e3" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#0071e3" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(val) => formatDateShort(val)}
                      stroke="#86868b"
                      fontSize={12}
                    />
                    <YAxis
                      tickFormatter={(val) => formatDisplayCost(val, 0)}
                      stroke="#86868b"
                      fontSize={12}
                    />
                    <Tooltip
                      formatter={(value) => [formatDisplayCost(value), 'Cost']}
                      labelFormatter={(label) => formatDateShort(label)}
                      contentStyle={{
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        border: '1px solid #e8e8ed',
                        borderRadius: '12px',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)'
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="#0071e3"
                      strokeWidth={2}
                      fill="url(#costGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-apple-gray-400">
                  No trend data available
                </div>
              )}
            </GlassCard>

            {/* Cost Breakdown Pie */}
            <GlassCard className="p-6">
              <h3 className="text-lg font-semibold text-apple-gray-800 mb-4">Cost Breakdown</h3>
              {pieData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <RechartsPie>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => formatDisplayCost(value)}
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          border: '1px solid #e8e8ed',
                          borderRadius: '12px'
                        }}
                      />
                    </RechartsPie>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {pieData.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-2">
                      <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-xs text-apple-gray-600">{entry.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-[200px] text-apple-gray-400">
                  <PieChart className="w-8 h-8 mr-2" />
                  No data
                </div>
              )}
            </GlassCard>
          </div>

          {/* High Cost Days */}
          {costData.anomalies?.highCostDays?.length > 0 && (
            <GlassCard className="p-6">
              <h3 className="text-lg font-semibold text-apple-gray-800 mb-4">High Cost Days</h3>
              <div className="space-y-3">
                {costData.anomalies.highCostDays.map((day, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-xl bg-red-50/50 border border-red-100">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-4 h-4 text-apple-red" />
                      <span className="text-sm font-medium text-apple-gray-800">{formatDateShort(day.date)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-apple-red">{formatDisplayCost(day.cost)}</span>
                      <p className="text-xs text-apple-gray-400">{day.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </>
      ) : (
        <GlassCard className="p-12 text-center">
          <IndianRupee className="w-12 h-12 text-apple-gray-300 mx-auto mb-4" />
          <p className="text-sm text-apple-gray-500">No cost data available</p>
          <p className="text-xs text-apple-gray-400 mt-1">Start monitoring to see cost analytics</p>
        </GlassCard>
      )}
    </div>
  );
}
