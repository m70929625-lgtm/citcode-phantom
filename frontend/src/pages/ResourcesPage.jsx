import { useOutletContext } from 'react-router-dom';
import ResourceMonitor from '../components/ResourceMonitor';

export default function ResourcesPage() {
  const { globalFilters } = useOutletContext();
  return <ResourceMonitor filters={globalFilters} />;
}
