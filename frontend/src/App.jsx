import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import AuthPage from './pages/AuthPage';
import OverviewPage from './pages/OverviewPage';
import ResourcesPage from './pages/ResourcesPage';
import AnomaliesPage from './pages/AnomaliesPage';
import CostsPage from './pages/CostsPage';
import ActionsPage from './pages/ActionsPage';
import ResourceDetailPage from './pages/ResourceDetailPage';
import AnomalyDetailPage from './pages/AnomalyDetailPage';
import ActionDetailPage from './pages/ActionDetailPage';
import ReportsPage from './pages/ReportsPage';

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
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="resources" element={<ResourcesPage />} />
            <Route path="resources/:resourceId" element={<ResourceDetailPage />} />
            <Route path="anomalies" element={<AnomaliesPage />} />
            <Route path="anomalies/:anomalyId" element={<AnomalyDetailPage />} />
            <Route path="costs" element={<CostsPage />} />
            <Route path="actions" element={<ActionsPage />} />
            <Route path="actions/:actionId" element={<ActionDetailPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
