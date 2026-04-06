import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bookmark,
  BookmarkMinus,
  FileBarChart2,
  IndianRupee,
  LogOut,
  Monitor,
  Settings,
  Shield,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SettingsPanel from './SettingsPanel';
import { createSavedView, deleteSavedView, getSavedViews } from '../hooks/useApi';

const NAV_ITEMS = [
  { to: '/overview', label: 'Overview', icon: Activity },
  { to: '/resources', label: 'Resources', icon: Monitor },
  { to: '/anomalies', label: 'Anomalies', icon: AlertTriangle },
  { to: '/costs', label: 'Cost Analysis', icon: IndianRupee },
  { to: '/actions', label: 'Actions', icon: Zap },
  { to: '/reports', label: 'Reports', icon: FileBarChart2 },
];

function normalizeViewFilters(queryParams = {}) {
  return {
    window: queryParams.window || '24h',
    service: queryParams.service || 'all',
    status: queryParams.status || 'all',
    region: queryParams.region || 'all'
  };
}

export default function AppShell() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [savedViews, setSavedViews] = useState([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('');

  useEffect(() => {
    fetchStatus();
    loadSavedViews();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const globalFilters = useMemo(() => ({
    window: searchParams.get('window') || '24h',
    service: searchParams.get('service') || 'all',
    status: searchParams.get('status') || 'all',
    region: searchParams.get('region') || 'all'
  }), [searchParams]);

  const hasAnyFilterInUrl = useMemo(() => {
    return ['window', 'service', 'status', 'region'].some((key) => searchParams.get(key));
  }, [searchParams]);

  useEffect(() => {
    if (hasAnyFilterInUrl || savedViews.length === 0) {
      return;
    }

    const defaultView = savedViews.find((view) => view.isDefault);
    if (!defaultView?.queryParams) {
      return;
    }

    applyFilters(defaultView.queryParams);
  }, [savedViews, hasAnyFilterInUrl]);

  useEffect(() => {
    const matchingView = savedViews.find((view) => {
      const normalized = normalizeViewFilters(view.queryParams || {});
      return normalized.window === globalFilters.window
        && normalized.service === globalFilters.service
        && normalized.status === globalFilters.status
        && normalized.region === globalFilters.region;
    });

    setSelectedSavedViewId(matchingView ? matchingView.id : '');
  }, [savedViews, globalFilters.window, globalFilters.service, globalFilters.status, globalFilters.region]);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/status');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    } finally {
      setStatusLoading(false);
    }
  };

  const loadSavedViews = async () => {
    try {
      const response = await getSavedViews();
      setSavedViews(response.data || []);
    } catch (error) {
      console.error('Failed to load saved views:', error);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    try {
      await logout();
      navigate('/auth', { replace: true });
    } catch (error) {
      console.error('Failed to log out:', error);
    } finally {
      setLoggingOut(false);
    }
  };

  const applyFilters = (nextFilters = {}) => {
    const params = new URLSearchParams(searchParams);
    ['window', 'service', 'status', 'region'].forEach((key) => {
      const value = nextFilters[key];
      if (!value || value === 'all') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    setSearchParams(params, { replace: true });
  };

  const updateFilter = (key, value) => {
    applyFilters({
      ...globalFilters,
      [key]: value
    });
  };

  const resetFilters = () => {
    applyFilters({ window: '24h', service: 'all', status: 'all', region: 'all' });
  };

  const handleSaveCurrentView = async () => {
    const name = window.prompt('Enter a name for this view');
    if (!name || name.trim().length < 2) {
      return;
    }

    try {
      await createSavedView({
        name: name.trim(),
        queryParams: globalFilters,
        isDefault: false
      });
      await loadSavedViews();
    } catch (error) {
      console.error('Failed to save view:', error);
      window.alert(error.message || 'Failed to save view');
    }
  };

  const handleApplySavedView = (viewId) => {
    setSelectedSavedViewId(viewId);
    const selected = savedViews.find((view) => view.id === viewId);
    if (selected) {
      applyFilters(selected.queryParams || {});
    }
  };

  const handleDeleteSelectedView = async () => {
    if (!selectedSavedViewId) return;

    try {
      await deleteSavedView(selectedSavedViewId);
      setSelectedSavedViewId('');
      await loadSavedViews();
    } catch (error) {
      console.error('Failed to delete view:', error);
      window.alert(error.message || 'Failed to delete view');
    }
  };

  const navSearch = searchParams.toString() ? `?${searchParams.toString()}` : '';

  return (
    <div className="min-h-screen">
      <header className="sticky top-4 z-50 px-4 sm:px-6">
        <div className="glass mx-auto flex max-w-7xl items-center justify-between rounded-full px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#e9eef9_0%,#a8bff5_42%,#ffb26f_100%)] shadow-[0_18px_35px_rgba(15,23,42,0.16)]">
              <Shield className="h-5 w-5 text-[#111318]" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-apple-gray-400">AWS monitoring</p>
              <h1 className="text-sm font-semibold text-apple-gray-800 sm:text-base">Cloud cost control</h1>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full bg-white/50 px-3 py-2 text-xs text-apple-gray-500 md:flex">
            <span className={`h-2 w-2 rounded-full ${status?.awsConnected ? 'bg-apple-green' : 'bg-apple-red'} animate-pulse`} />
            <span>{status?.awsConnected ? `AWS connected in ${status?.awsRegion || 'region'}` : 'AWS not connected'}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="toolbar-button h-11 px-4 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden text-sm sm:inline">{loggingOut ? 'Logging out...' : 'Log out'}</span>
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 text-apple-gray-700 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:bg-white"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        <section className="hero-panel px-6 py-8 text-white sm:px-8 sm:py-10">
          <div className="relative z-[1] grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <p className="hero-kicker">Workspace</p>
              <h2 className="mt-4 text-[clamp(2.3rem,6vw,4.6rem)] font-semibold leading-[0.95] tracking-[-0.05em] text-white">
                Dedicated pages for every cloud operations workflow.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/70 sm:text-base">
                Move across overview, resources, anomalies, cost analysis and actions with persistent navigation and deep links.
              </p>

              <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-white/65">
                  Window
                  <select
                    value={globalFilters.window}
                    onChange={(event) => updateFilter('window', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="24h">24h</option>
                    <option value="7d">7d</option>
                    <option value="30d">30d</option>
                    <option value="90d">90d</option>
                  </select>
                </label>

                <label className="text-xs text-white/65">
                  Service
                  <select
                    value={globalFilters.service}
                    onChange={(event) => updateFilter('service', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="all">All</option>
                    <option value="EC2">EC2</option>
                    <option value="S3">S3</option>
                    <option value="RDS">RDS</option>
                    <option value="Lambda">Lambda</option>
                  </select>
                </label>

                <label className="text-xs text-white/65">
                  Status
                  <select
                    value={globalFilters.status}
                    onChange={(event) => updateFilter('status', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="all">All</option>
                    <option value="new">New</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="resolved">Resolved</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="executed">Executed</option>
                    <option value="dismissed">Dismissed</option>
                  </select>
                </label>

                <label className="text-xs text-white/65">
                  Region
                  <select
                    value={globalFilters.region}
                    onChange={(event) => updateFilter('region', event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="all">All</option>
                    <option value="us-east-1">us-east-1</option>
                    <option value="us-east-2">us-east-2</option>
                    <option value="us-west-1">us-west-1</option>
                    <option value="us-west-2">us-west-2</option>
                    <option value="ap-south-1">ap-south-1</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={handleSaveCurrentView} className="secondary-button px-3 py-2 text-xs">
                  <Bookmark className="h-3.5 w-3.5" />
                  Save View
                </button>

                <select
                  value={selectedSavedViewId}
                  onChange={(event) => handleApplySavedView(event.target.value)}
                  className="rounded-full border border-white/20 bg-black/20 px-3 py-2 text-xs text-white outline-none"
                >
                  <option value="">Apply Saved View</option>
                  {savedViews.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.name}{view.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>

                <button onClick={handleDeleteSelectedView} className="secondary-button px-3 py-2 text-xs" disabled={!selectedSavedViewId}>
                  <BookmarkMinus className="h-3.5 w-3.5" />
                  Delete View
                </button>

                <button onClick={resetFilters} className="secondary-button px-3 py-2 text-xs">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Reset Filters
                </button>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-white/42">Live status</p>
              <div className="mt-4 space-y-3 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <span>Connection</span>
                  <span>{status?.awsConnected ? 'Connected' : 'Not connected'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Region</span>
                  <span>{status?.awsRegion || 'Not set'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Pending actions</span>
                  <span>{status?.pendingActions || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Anomalies</span>
                  <span>{status?.recentAnomalies || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="premium-panel hidden rounded-[30px] p-4 lg:block">
            <div className="relative z-[1]">
              <p className="section-kicker mb-3">Navigation</p>
              <nav className="space-y-2">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={{ pathname: item.to, search: navSearch }}
                      className={({ isActive }) => `segment-tab w-full justify-start ${isActive ? 'segment-tab-active' : ''}`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>

              {!statusLoading && (
                <div className="mt-5 rounded-[22px] border border-white/75 bg-white/60 p-3 text-xs text-apple-gray-500">
                  Overview source: <span className="font-medium text-apple-gray-700">{status?.overviewSource || 'unknown'}</span>
                </div>
              )}
            </div>
          </aside>

          <section className="min-w-0">
            <nav className="segment-shell mb-4 lg:hidden">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={{ pathname: item.to, search: navSearch }}
                    className={({ isActive }) => `segment-tab ${isActive ? 'segment-tab-active' : ''}`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>

            <Outlet context={{ status, refreshStatus: fetchStatus, globalFilters, applyFilters }} />
          </section>
        </div>
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onSaved={fetchStatus} />}
    </div>
  );
}
