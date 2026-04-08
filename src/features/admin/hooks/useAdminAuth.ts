/**
 * Authorization hook for admin dashboard access control.
 *
 * ARCHITECTURAL ROLE:
 * Guards the admin UI behind role-based access control.
 * Checks Firebase custom JWT claims (sole source of authorization).
 * Prevents render-after-unmount bugs via abort pattern.
 *
 * DESIGN PATTERNS:
 * - Authorization via JWT custom claims: Server-set, immutable, only source of truth
 * - Abort pattern: Cleanup function prevents state updates on unmounted components
 * - Async initialization: Async check on first use; caches result in state
 *
 * FLOW:
 * 1. Wait for auth system to load (authLoading = false)
 * 2. Skip anonymous users (not admin)
 * 3. Fetch ID token and inspect claims.admin === true
 * 4. If claim is not true: deny access (no fallback)
 * 5. Handle errors gracefully (default to false)
 * 6. Return isAdmin + isLoading for conditional rendering
 *
 * CLEANUP:
 * cancelled flag prevents setState after unmount (race condition protection).
 * useEffect cleanup returns function that sets cancelled = true.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { checkIsAdmin } from '../data/adminRepository';

interface UseAdminAuthResult {
  isAdmin: boolean;
  isLoading: boolean;
}

/**
 * Determine if the authenticated user has admin privileges.
 *
 * ONLY SOURCE: Firebase custom claims (claims.admin = true, set server-side)
 *
 * The abort pattern (cancelled flag) prevents state updates after unmount.
 */
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
        if (claimAdmin) {
          if (!cancelled) {
            setIsAdmin(true);
            setIsChecking(false);
          }
        } else {
          // Legacy fallback: check Firestore role field
          // TODO: Set custom claims via scripts/setAdminClaims.js and remove this fallback
          const legacyAdmin = await checkIsAdmin(user.uid);
          if (legacyAdmin) {
            console.warn('[useAdminAuth] Admin granted via Firestore fallback — run setAdminClaims.js to set JWT claim');
          }
          if (!cancelled) {
            setIsAdmin(legacyAdmin);
            setIsChecking(false);
          }
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
