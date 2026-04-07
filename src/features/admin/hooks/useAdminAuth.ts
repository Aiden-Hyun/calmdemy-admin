/**
 * Authorization hook for admin dashboard access control.
 *
 * ARCHITECTURAL ROLE:
 * Guards the admin UI behind role-based access control.
 * Checks Firebase custom JWT claims (primary source) with Firestore fallback (legacy).
 * Prevents render-after-unmount bugs via abort pattern.
 *
 * DESIGN PATTERNS:
 * - Authorization via JWT custom claims: Server-set, immutable, most reliable
 * - Fallback mechanism: Firestore role check if claims unavailable (backwards compat)
 * - Abort pattern: Cleanup function prevents state updates on unmounted components
 * - Async initialization: Async check on first use; caches result in state
 *
 * FLOW:
 * 1. Wait for auth system to load (authLoading = false)
 * 2. Skip anonymous users (not admin)
 * 3. Fetch ID token and inspect claims.admin === true
 * 4. If claim missing: Firestore fallback (display-only, not authoritative)
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
 * PRIMARY: Firebase custom claims (claims.admin = true, set server-side)
 * FALLBACK: Firestore admin role document (display only, not authoritative)
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
