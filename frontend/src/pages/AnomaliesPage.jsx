import { useOutletContext } from 'react-router-dom';
import AnomalyAlerts from '../components/AnomalyAlerts';

export default function AnomaliesPage() {
  const { globalFilters } = useOutletContext();
  return <AnomalyAlerts filters={globalFilters} />;
}
