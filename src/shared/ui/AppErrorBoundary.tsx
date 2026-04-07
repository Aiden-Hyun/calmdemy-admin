/**
 * ============================================================
 * AppErrorBoundary.tsx — Error Boundary for Unhandled Errors
 * (Error Boundary Pattern, Graceful Degradation)
 * ============================================================
 *
 * Architectural Role:
 *   This class component catches unhandled errors during rendering,
 *   lifecycle methods, and constructors. It's a safety net that prevents
 *   the entire app from crashing to a blank white screen. Instead, it
 *   shows a user-friendly error message and a retry button.
 *
 *   Typically wrapped around the root App component or major feature
 *   boundary to catch rendering errors from any child.
 *
 * Design Patterns:
 *   - Error Boundary Pattern (React): Uses getDerivedStateFromError() and
 *     componentDidCatch() lifecycle methods to detect and log errors,
 *     then render an error fallback UI.
 *   - Graceful Degradation: Instead of a crash, users see a clear message
 *     and recovery option (Try Again button).
 *   - Class Component: Must be a class because React.Component is required
 *     for getDerivedStateFromError() and componentDidCatch().
 *
 * Limitations:
 *   - Does NOT catch errors in:
 *     * Event handlers (use try-catch inside handlers instead)
 *     * Async code / promises (use .catch() or try-catch in async/await)
 *     * Server-side rendering (not applicable in React Native)
 *     * Errors in the error boundary itself
 *   - The retry button simply clears the error state, re-rendering children.
 *     If the error is in cached state, the error may recur unless the state
 *     is truly cleared (e.g., localStorage, Redux, Context).
 *
 * Consumed By:
 *   Root App component or feature-level screens that need error boundaries.
 *
 * Key Dependencies:
 *   - React.Component: required for class-based error boundary
 *   - lightColors theme: for error UI styling
 * ============================================================
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { lightColors } from "@/theme";

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * AppErrorBoundary — Class-based Error Boundary
 *
 * This class component wraps a component tree and catches unhandled errors
 * during rendering. It's the error boundary pattern applied to React Native.
 *
 * Two lifecycle methods are key:
 * - getDerivedStateFromError(): Called during render; updates state synchronously
 * - componentDidCatch(): Called after an error is thrown; can log or report
 */
export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
  };

  /**
   * Lifecycle method: Invoked when a child component throws an error.
   * Must return a new state object to mark the boundary as having caught an error.
   *
   * This method is called DURING render, so it must be pure and not have side effects.
   * Use componentDidCatch() for side effects like logging.
   */
  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  /**
   * Lifecycle method: Called AFTER an error has been thrown, during the commit phase.
   * This is where you log the error, report to a service, or trigger analytics.
   *
   * The errorInfo parameter contains the component stack trace, which is useful
   * for debugging which component caused the error.
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Caught error:', error?.message);
    console.error('[AppErrorBoundary] Stack:', error?.stack);
    console.error('[AppErrorBoundary] Component stack:', errorInfo?.componentStack);
    // In production, you might report this to a logging service (e.g., Sentry)
  }

  /**
   * Retry handler: Resets the error state, which re-renders children.
   * This is a simple recovery mechanism; for persistent errors (e.g., corrupted
   * Firestore cache), the error will recur unless the root cause is cleared.
   *
   * Arrow function syntax ensures 'this' binding without needing .bind()
   */
  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    // Render fallback UI if an error was caught
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>🌿</Text>
          <Text style={styles.title}>Calmdemy hit a startup problem</Text>
          <Text style={styles.body}>
            Please try again. If this keeps happening, reinstalling the app
            should clear the broken cached state from this build.
          </Text>
          <Pressable onPress={this.handleRetry} style={styles.button}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    // No error: render children as normal
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightColors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: lightColors.text,
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: lightColors.textLight,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    backgroundColor: lightColors.primary,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    color: lightColors.textOnPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
});
