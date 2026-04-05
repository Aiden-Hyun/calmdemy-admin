import { useEffect, useState } from 'react';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { checkIsAdmin } from '../data/adminRepository';

interface UseAdminAuthResult {
  isAdmin: boolean;
  isLoading: boolean;
}

export function useAdminAuth(): UseAdminAuthResult {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!user || user.isAnonymous) {
      setIsAdmin(false);
      setIsChecking(false);
      return;
    }

    let cancelled = false;
    setIsChecking(true);

    (async () => {
      try {
        const token = await user.getIdTokenResult(true);
        const claimAdmin = token.claims?.admin === true;
        if (!claimAdmin) {
          // Legacy fallback: Firestore role (display-only, not authoritative)
          const legacy = await checkIsAdmin(user.uid);
          if (!cancelled) {
            setIsAdmin(legacy);
            setIsChecking(false);
          }
          return;
        }
        if (!cancelled) {
          setIsAdmin(true);
          setIsChecking(false);
        }
      } catch {
        if (!cancelled) {
          setIsAdmin(false);
          setIsChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return {
    isAdmin,
    isLoading: authLoading || isChecking,
  };
}
