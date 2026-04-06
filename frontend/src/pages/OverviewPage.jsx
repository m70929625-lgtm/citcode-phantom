import { useOutletContext } from 'react-router-dom';
import Dashboard from '../components/Dashboard';

export default function OverviewPage() {
  const { status, refreshStatus, globalFilters } = useOutletContext();

  return <Dashboard status={status} onRefresh={refreshStatus} filters={globalFilters} />;
}
