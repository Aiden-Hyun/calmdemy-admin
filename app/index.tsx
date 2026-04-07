import { Redirect } from 'expo-router';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { LoadingScreen } from '@shared/ui/LoadingScreen';

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Loading admin..." />;
  }

  if (!user || user.isAnonymous) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/admin" />;
}
