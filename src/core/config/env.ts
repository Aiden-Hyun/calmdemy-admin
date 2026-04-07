/**
 * ============================================================
 * env.ts — Environment Configuration (Configuration Layer)
 * ============================================================
 *
 * Architectural Role:
 *   Centralizes all environment variable access behind a typed,
 *   validated object. This is the Facade pattern applied to
 *   process.env — instead of scattering process.env lookups
 *   across the codebase, every module imports `env` from here.
 *
 * Design Patterns:
 *   - Facade: Wraps the untyped process.env Record<string, string>
 *     behind a structured, nested object with semantic grouping
 *     (firebase, google, revenuecat).
 *   - Fail-Soft with Warnings: getEnv logs a warning for missing
 *     vars and returns empty string instead of throwing, so the
 *     app can still boot in partial environments (e.g., web-only
 *     dev where iOS-specific keys aren't set).
 *
 * Expo Convention:
 *   All keys use the EXPO_PUBLIC_ prefix — Expo's build system
 *   only bundles env vars with this prefix into the client JS
 *   bundle. Keys without this prefix are stripped at build time.
 *
 * Key Consumers:
 *   - src/firebase.ts / src/firebase.web.ts (Firebase init config)
 *   - AuthContext (Google/Apple sign-in client IDs)
 *   - SubscriptionContext (RevenueCat API key)
 * ============================================================
 */

/**
 * Safe environment variable accessor with optional fallback.
 * Logs a console warning (not an error) for missing keys —
 * this is intentional: some keys are only needed on certain
 * platforms, so a hard crash would break cross-platform dev.
 */
const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    console.warn(`[config] Missing environment variable: ${key}`);
    return '';
  }
  return value;
};

export const env = {
  firebase: {
    apiKey: getEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
    authDomain: getEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: getEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
    storageBucket: getEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: getEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
    appId: getEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
  },
  google: {
    webClientId: getEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'),
    iosClientId: getEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'),
  },
  revenuecat: {
    apiKey: getEnv('EXPO_PUBLIC_REVENUECAT_API_KEY'),
    entitlementId: getEnv('EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID', 'premium'),
  },
};
