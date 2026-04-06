import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3 } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import { getAnomaly } from '../hooks/useApi';
import { formatPercent, formatRelativeTime, formatCurrency } from '../utils/formatters';

export default function AnomalyDetailPage() {
  const { anomalyId } = useParams();
  const [anomaly, setAnomaly] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await getAnomaly(anomalyId);
        setAnomaly(response);
      } catch (error) {
        console.error('Failed to load anomaly detail:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [anomalyId]);

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-apple-blue/30 border-t-apple-blue" />
      </div>
    );
  }

  if (!anomaly) {
    return (
      <GlassCard className="p-8 text-center text-apple-gray-500">
        Anomaly not found.
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/anomalies" className="mb-3 inline-flex items-center gap-2 text-sm text-apple-gray-500 hover:text-apple-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Back to Anomalies
        </Link>
        <p className="section-kicker">Anomaly Detail</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">{anomaly.resourceName}</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Type</p>
          <p className="mt-2 text-xl font-semibold text-apple-gray-800">{anomaly.type}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Score</p>
          <p className="mt-2 text-xl font-semibold text-apple-gray-800">{formatPercent((anomaly.score || 0) * 100, 0)}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Confidence</p>
          <p className="mt-2 text-xl font-semibold text-apple-gray-800">{formatPercent((anomaly.confidence || 0) * 100, 0)}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Potential Savings</p>
          <p className="mt-2 text-xl font-semibold text-apple-green">{formatCurrency(anomaly.estimatedSavings || 0)}</p>
        </GlassCard>
      </div>

      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold text-apple-gray-800">Context</h3>
        <div className="mt-4 space-y-3 text-sm text-apple-gray-600">
          <p className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-apple-orange" /> Recommended Action: {anomaly.recommendedAction}</p>
          <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-apple-blue" /> Detected: {formatRelativeTime(anomaly.detectedAt)}</p>
          <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-apple-green" /> Status: {anomaly.status}</p>
          <p>Resource Type: {anomaly.resourceType}</p>
          <p>Resource ID: <span className="font-mono">{anomaly.resourceId}</span></p>
        </div>
      </GlassCard>
    </div>
  );
}
