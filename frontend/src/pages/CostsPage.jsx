import { useOutletContext } from 'react-router-dom';
import CostTrends from '../components/CostTrends';

export default function CostsPage() {
  const { globalFilters } = useOutletContext();
  return <CostTrends filters={globalFilters} />;
}
