import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import GlassCard from '../components/GlassCard';
import { createReportJob, getReportJobs, getReportSummary } from '../hooks/useApi';
import { formatCurrency, formatNumber } from '../utils/formatters';

function mapWindowToReportPeriod(windowValue) {
  if (windowValue === '7d') return '7d';
  if (windowValue === '90d') return '90d';
  return '30d';
}

export default function ReportsPage() {
  const { globalFilters } = useOutletContext();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [creatingFormat, setCreatingFormat] = useState(null);

  const period = mapWindowToReportPeriod(globalFilters.window);

  const triggerDownload = async (job) => {
    const response = await fetch(`/api/reports/jobs/${job.id}/download`, {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Failed to download report');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = job.fileName || `report-${job.id}.${job.format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [summaryData, jobsData] = await Promise.all([
        getReportSummary({ ...globalFilters, period }),
        getReportJobs(20)
      ]);

      setSummary(summaryData || null);
      setJobs(jobsData.data || []);
    } catch (error) {
      console.error('Failed to load report:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [globalFilters.window, globalFilters.service, globalFilters.status, globalFilters.region]);

  const createAndDownloadReport = async (format) => {
    setCreatingFormat(format);
    try {
      const result = await createReportJob({
        format,
        period,
        filters: globalFilters
      });

      const createdJob = result.job;
      if (createdJob?.status === 'completed') {
        await triggerDownload(createdJob);
      }

      await load();
    } catch (error) {
      console.error('Failed to create report:', error);
      window.alert(error.message || 'Failed to create report');
    } finally {
      setCreatingFormat(null);
    }
  };

  const cards = useMemo(() => {
    if (!summary) return [];

    return [
      {
        title: 'Detected Anomalies',
        value: formatNumber(summary.overview?.anomalies?.total || 0, 0),
        sub: `${formatNumber(summary.overview?.anomalies?.new || 0, 0)} new`
      },
      {
        title: 'Actions Executed',
        value: formatNumber(summary.overview?.actions?.executed || 0, 0),
        sub: `${formatNumber(summary.overview?.actions?.simulated || 0, 0)} simulated`
      },
      {
        title: 'Total Savings',
        value: formatCurrency(summary.overview?.actions?.savings || 0, 'INR', 0),
        sub: 'Executed actions only'
      },
      {
        title: `${period.toUpperCase()} Estimated Cost`,
        value: formatCurrency(summary.overview?.costs?.estimatedPeriodCost || 0, 'INR', 0),
        sub: `Latest sample: ${formatCurrency(summary.overview?.costs?.latestCost || 0, summary.overview?.costs?.latestCurrency || 'USD', 2)}`
      }
    ];
  }, [summary, period]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-kicker">Reports</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">Reporting Hub</h2>
          <p className="mt-2 text-base text-apple-gray-500">Generate and export periodic operational and cost summaries.</p>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={load} className="toolbar-button" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => createAndDownloadReport('csv')}
            className="primary-button"
            disabled={!summary || creatingFormat !== null}
          >
            <Download className="h-4 w-4" />
            {creatingFormat === 'csv' ? 'Preparing CSV...' : 'Export CSV'}
          </button>
          <button
            onClick={() => createAndDownloadReport('pdf')}
            className="toolbar-button"
            disabled={!summary || creatingFormat !== null}
          >
            <FileText className="h-4 w-4" />
            {creatingFormat === 'pdf' ? 'Preparing PDF...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-apple-blue/30 border-t-apple-blue" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
              <GlassCard key={card.title} className="p-4">
                <p className="text-sm text-apple-gray-500">{card.title}</p>
                <p className="mt-2 text-2xl font-semibold text-apple-gray-800">{card.value}</p>
                <p className="mt-1 text-xs text-apple-gray-500">{card.sub}</p>
              </GlassCard>
            ))}
          </div>

          <GlassCard className="p-6">
            <div className="flex items-center gap-2 text-apple-gray-700">
              <FileText className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Report Snapshot</h3>
            </div>
            <pre className="mt-4 overflow-auto rounded-2xl bg-white/75 p-4 text-xs text-apple-gray-600">
              {JSON.stringify(summary, null, 2)}
            </pre>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-apple-gray-800">Recent Report Jobs</h3>
              <span className="text-xs text-apple-gray-500">{jobs.length} jobs</span>
            </div>
            {jobs.length === 0 ? (
              <p className="mt-3 text-sm text-apple-gray-500">No report exports yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {jobs.map((job) => (
                  <div key={job.id} className="muted-panel flex items-center justify-between rounded-xl p-3">
                    <div>
                      <p className="text-sm font-medium text-apple-gray-700">
                        {job.format.toUpperCase()} - {job.period}
                      </p>
                      <p className="text-xs text-apple-gray-500">{job.status} - {new Date(job.createdAt).toLocaleString()}</p>
                    </div>
                    {job.downloadUrl && (
                      <button className="toolbar-button" onClick={() => triggerDownload(job)}>
                        <Download className="h-4 w-4" />
                        Download
                      </button>
                    )}
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
