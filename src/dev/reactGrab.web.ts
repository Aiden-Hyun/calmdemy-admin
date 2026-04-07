/**
 * @fileoverview Web platform implementation of React Grab development tool.
 *
 * ARCHITECTURAL ROLE:
 * Conditionally loads React Grab library in development builds only.
 * Implements lazy-loading pattern to avoid blocking app startup.
 *
 * DESIGN PATTERN:
 * - Lazy Loading: Import deferred until first call (reduces bundle impact)
 * - Cached Promise: Prevents re-importing if already loaded
 * - Error Recovery: Clears cache on failure for retry attempts
 * - Development-Only: Completely skipped in production builds
 *
 * MODULE RESOLUTION:
 * - Expo/React Native uses file extensions for platform selection
 * - reactGrab.web.ts: Loaded on web (has actual import)
 * - reactGrab.ts: Loaded on native (no-op stub)
 * - Prevents "module not found" errors on unsupported platforms
 *
 * CONSUMPTION:
 * - Called during app initialization from main entry point
 * - __DEV__ flag ensures production builds skip entirely
 * - Error handling prevents deployment crashes
 */

// Cached promise prevents duplicate imports and tracks load state
let reactGrabImport: Promise<unknown> | null = null;

/**
 * Initializes React Grab development tools in web browser.
 *
 * DEVELOPMENT MODE:
 * - Loads React Grab library for component inspection
 * - Provides browser console integration for React debugging
 * - Call-safe: Only loads once despite multiple calls
 *
 * PRODUCTION MODE (__DEV__ === false):
 * - Completely skipped by Expo build process
 * - No overhead, no tree-shake needed
 * - Safe to call in production code
 *
 * ERROR HANDLING:
 * - Catches import errors (library may not be in dependencies)
 * - Logs error but doesn't crash app (graceful degradation)
 * - Resets cache on failure to allow retries
 *
 * PERFORMANCE NOTE:
 * - Async import: Non-blocking, doesn't delay startup
 * - Only active during development (dev server or dev build)
 * - Negligible impact on app performance
 */
export function initReactGrab() {
  // Skip entirely in production builds (Expo tree-shakes this)
  if (!__DEV__) {
    return;
  }

  // Prevent duplicate imports - cache the promise
  if (!reactGrabImport) {
    // Lazy import: React Grab only loaded if initReactGrab() called
    reactGrabImport = import('react-grab').catch((error) => {
      // Clear cache on failure to allow retry on next call
      reactGrabImport = null;
      // Non-fatal error: development tool not critical to app function
      console.error('Failed to load react-grab:', error);
    });
  }
}
