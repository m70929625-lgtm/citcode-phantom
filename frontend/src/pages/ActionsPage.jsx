import { useOutletContext } from 'react-router-dom';
import ActionCenter from '../components/ActionCenter';

export default function ActionsPage() {
  const { globalFilters } = useOutletContext();
  return <ActionCenter filters={globalFilters} />;
}
