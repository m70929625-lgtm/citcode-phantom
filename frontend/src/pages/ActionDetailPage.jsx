import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, PlayCircle, ShieldCheck } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import { getAction } from '../hooks/useApi';
import { formatRelativeTime, formatCurrency } from '../utils/formatters';

export default function ActionDetailPage() {
  const { actionId } = useParams();
  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const response = await getAction(actionId);
        setAction(response);
      } catch (error) {
        console.error('Failed to load action detail:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [actionId]);

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-apple-blue/30 border-t-apple-blue" />
      </div>
    );
  }

  if (!action) {
    return <GlassCard className="p-8 text-center text-apple-gray-500">Action not found.</GlassCard>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/actions" className="mb-3 inline-flex items-center gap-2 text-sm text-apple-gray-500 hover:text-apple-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Back to Actions
        </Link>
        <p className="section-kicker">Action Detail</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">{action.actionType?.replace('_', ' ')}</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Resource</p>
          <p className="mt-2 text-xl font-semibold text-apple-gray-800">{action.resourceName}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Status</p>
          <p className="mt-2 text-xl font-semibold text-apple-gray-800">{action.status}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Dry Run</p>
          <p className="mt-2 text-xl font-semibold text-apple-gray-800">{action.dryRun ? 'Yes' : 'No'}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-sm text-apple-gray-500">Savings</p>
          <p className="mt-2 text-xl font-semibold text-apple-green">{formatCurrency(action.savings || 0)}</p>
        </GlassCard>
      </div>

      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold text-apple-gray-800">Execution Timeline</h3>
        <div className="mt-4 space-y-3 text-sm text-apple-gray-600">
          <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-apple-blue" /> Created: {formatRelativeTime(action.createdAt)}</p>
          {action.approvedAt && <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-apple-green" /> Approved: {formatRelativeTime(action.approvedAt)}</p>}
          {action.executedAt && <p className="flex items-center gap-2"><PlayCircle className="h-4 w-4 text-apple-green" /> Executed: {formatRelativeTime(action.executedAt)}</p>}
          {action.error && <p className="text-apple-red">Error: {action.error}</p>}
          {action.result?.message && <p>Result: {action.result.message}</p>}
          <p>Resource ID: <span className="font-mono">{action.resourceId}</span></p>
        </div>
      </GlassCard>
    </div>
  );
}
