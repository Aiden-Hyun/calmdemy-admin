import { Redirect } from 'expo-router';

import { useAuth } from '@core/providers/contexts/AuthContext';

export default function IndexScreenWeb() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  return <Redirect href={user ? '/admin' : '/login'} />;
}
