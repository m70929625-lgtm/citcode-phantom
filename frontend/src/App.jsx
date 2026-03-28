import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Dashboard from './components/Dashboard';
import ResourceMonitor from './components/ResourceMonitor';
import AnomalyAlerts from './components/AnomalyAlerts';
import CostTrends from './components/CostTrends';
import ActionCenter from './components/ActionCenter';
import SettingsPanel from './components/SettingsPanel';
import AuthPage from './pages/AuthPage';
import ProtectedRoute from './components/ProtectedRoute';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cpu,
  IndianRupee,
  Monitor,
  Settings,
  Shield,
  Zap,
} from 'lucide-react';

function AppLayout() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'dashboard', label: 'Overview', icon: Activity },
    { id: 'resources', label: 'Resources', icon: Monitor },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
    { id: 'costs', label: 'Costs', icon: IndianRupee },
    { id: 'actions', label: 'Actions', icon: Zap },
  ];

  const currentTab = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  const heroChips = [
    {
      label: 'Connection',
      value: status?.awsConnected ? 'Connected' : 'Not connected',
      className: status?.awsConnected ? 'hero-chip-active' : '',
    },
    {
      label: 'Region',
      value: status?.awsRegion || 'Not set',
      className: '',
    },
    {
      label: 'Detection',
      value: status?.mlModelLoaded ? 'ML model ready' : 'Fallback detection',
      className: !status?.mlModelLoaded ? 'hero-chip-warn' : '',
    },
  ];

  const handleOverviewClick = () => {
    setActiveTab('dashboard');
    window.requestAnimationFrame(() => {
      document.getElementById('workspace-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard status={status} onRefresh={fetchStatus} />;
      case 'resources':
        return <ResourceMonitor />;
      case 'alerts':
        return <AnomalyAlerts />;
      case 'costs':
        return <CostTrends />;
      case 'actions':
        return <ActionCenter />;
      default:
        return <Dashboard status={status} onRefresh={fetchStatus} />;
    }
  };

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

          <button
            onClick={() => setShowSettings(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 text-apple-gray-700 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:bg-white"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        <section className="hero-panel px-6 py-8 text-white sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <div className="relative z-[1] grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <p className="hero-kicker">AWS cost monitoring</p>
              <h2 className="mt-4 max-w-4xl text-[clamp(3rem,7vw,6rem)] font-semibold leading-[0.95] tracking-[-0.05em] text-white">
                Track cost, anomalies and actions across one AWS account.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/72 sm:text-lg">
                Add your AWS access key, secret key and region, then use one dashboard to review usage, estimated spend, detected issues and recommended cost-saving actions.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button onClick={handleOverviewClick} className="primary-button">
                  View overview
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {heroChips.map((chip) => (
                  <div key={chip.label} className={`hero-chip rounded-[24px] px-4 py-4 ${chip.className}`}>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-white/45">{chip.label}</p>
                    <p className="mt-3 text-sm font-medium text-white/88">{chip.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-device p-3 sm:p-4">
              <div className="hero-screen p-5 text-white sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-white/35">AWS status</p>
                    <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white">Current account summary</h3>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/50">
                    {status?.awsConnected ? 'Live' : 'Standby'}
                  </div>
                </div>

                <div className="mt-8 grid gap-4">
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between text-white/55">
                      <span className="text-[11px] uppercase tracking-[0.28em]">Region</span>
                      <Cpu className="h-4 w-4" />
                    </div>
                    <p className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{status?.awsRegion || 'Connecting'}</p>
                    <p className="mt-2 text-sm text-white/45">Region used for connection checks, metric collection and action planning.</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-[0.28em] text-white/42">Usage coverage</span>
                        <span className="text-xs text-white/38">{status?.awsConnected ? 'Active' : 'Pending'}</span>
                      </div>
                      <div className="mt-5 space-y-3">
                        <div className="flex items-center justify-between text-sm text-white/72">
                          <span>Tracked services</span>
                          <span>{Object.keys(status?.resources || {}).length}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-white/72">
                          <span>EC2 instances</span>
                          <span>{status?.resources?.EC2 || 0}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-white/72">
                          <span>Last collection</span>
                          <span>{status?.lastFetchAt ? 'Available' : 'Pending'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-white/42">Review queue</p>
                      <div className="mt-5 space-y-4">
                        <div>
                          <p className="text-3xl font-semibold tracking-[-0.04em]">{status?.pendingActions || 0}</p>
                          <p className="text-sm text-white/45">pending actions</p>
                        </div>
                        <div>
                          <p className="text-3xl font-semibold tracking-[-0.04em]">{status?.recentAnomalies || 0}</p>
                          <p className="text-sm text-white/45">recent anomalies</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="workspace-section" className="mt-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="section-kicker">Workspace</p>
            <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800 sm:text-4xl">
              {currentTab.label}
            </h3>
            <p className="mt-2 max-w-2xl text-base leading-7 text-apple-gray-500">
              Review metrics, spend, anomalies and actions for the selected AWS region.
            </p>
          </div>

          <nav className="segment-shell">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`segment-tab ${isActive ? 'segment-tab-active' : ''}`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </section>

        <section className="mt-8">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 rounded-full border-[3px] border-apple-blue/30 border-t-apple-blue animate-spin" />
                <p className="text-sm text-apple-gray-500">Loading cloud cost control...</p>
              </div>
            </div>
          ) : (
            <div className="animate-in">
              {renderContent()}
            </div>
          )}
        </section>
      </main>

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} onSaved={fetchStatus} />
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
