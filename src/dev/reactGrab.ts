/**
 * @fileoverview Native platform stub for React Grab (empty on native).
 *
 * ARCHITECTURAL ROLE:
 * Provides cross-platform entry point for development debugging tool.
 * Implements platform-specific conditional loading via module exports.
 *
 * DESIGN PATTERN:
 * - Conditional Compilation: Native platform returns no-op
 * - Platform-Specific Exports: Web version has actual implementation
 *
 * CONSUMPTION:
 * - Called during app startup from main entry point
 * - Web bundle includes full React Grab library
 * - Native bundle uses this stub (prevents bloating native binary)
 *
 * WHY NEEDED:
 * - React Grab is web-only (browser console debugging)
 * - React Native doesn't benefit from browser dev tools
 * - Stub allows shared initialization code without platform checks
 */

/**
 * Initializes React Grab development tool (no-op on native).
 *
 * DEVELOPMENT TOOL:
 * - Browser-based component/prop inspector
 * - Inspect React component tree during development
 * - Only loaded in dev builds (__DEV__ flag)
 *
 * NATIVE PLATFORM:
 * - This stub version does nothing (optimization)
 * - Web platform (reactGrab.web.ts) loads actual library
 */
export function initReactGrab() {}
