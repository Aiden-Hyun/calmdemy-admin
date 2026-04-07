/**
 * Audio Service - Global Audio Configuration Utilities
 *
 * ARCHITECTURAL ROLE:
 * Low-level utility layer for setting up device-wide audio behavior in React Native/Expo.
 * Handles platform-specific audio mode configuration and global audio state management.
 * Decoupled from actual playback logic (handled by useAudioPlayer hook).
 *
 * DESIGN PATTERNS:
 * - Utility/Procedural Pattern: Provides pure functions for setup and configuration
 * - Initialization: configureAudioMode() should be called once at app startup
 * - Error Handling: Gracefully warns on failures; does not throw (allows app to continue)
 *
 * KEY DEPENDENCIES:
 * - expo-audio: Provides setAudioModeAsync() and setIsAudioActiveAsync() for iOS/Android control
 *
 * CONSUMERS:
 * - App.tsx: Calls configureAudioMode() during app initialization
 * - useAudioPlayer hook: Calls setAudioActive() when initializing playback context
 * - Feature screens: May call setAudioActive() for pause/resume behavior
 *
 * IMPORTANT NOTES:
 * - This service is for CONFIGURATION only; actual playback uses useAudioPlayer hook
 * - 'doNotMix' interruptionMode means background music stops when this app plays audio
 * - 'playsInSilentMode: true' ensures meditation audio plays even if phone is muted
 *
 * PLATFORM: React Native/Expo only (web doesn't use this)
 */

import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

/**
 * Snapshot of audio player state.
 * Typically tracked in a hook or Redux store, not directly used by this service.
 * Provided here for reference by components integrating with useAudioPlayer.
 *
 * USAGE: This interface is exported for type safety in components that manage
 * their own audio state. The actual state is managed by the useAudioPlayer hook,
 * which handles playback, not this service (which only configures device audio).
 */
export interface AudioState {
  isPlaying: boolean;
  isLoading: boolean;
  duration: number;
  position: number;
  error: string | null;
}

/**
 * INITIALIZATION: Configure global audio mode for the app.
 * Should be called once during app startup (e.g., in useEffect of root App component).
 *
 * Configuration details:
 * - playsInSilentMode: true - Audio plays when phone is muted (critical for meditation)
 * - shouldPlayInBackground: true - Audio continues if app goes to background
 * - shouldRouteThroughEarpiece: false - Use speaker/headphones, not phone earpiece
 * - interruptionMode: 'doNotMix' - Pause when other apps (music, calls) play audio
 *
 * @throws Does not throw; logs warning on failure to allow graceful degradation
 */
export async function configureAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
      /**
       * PLATFORM BEHAVIOR:
       * 'doNotMix': Pauses app audio if user receives call or other app plays audio.
       * Alternatives: 'duckOthers' (lowers other app volume), 'mixWithOthers' (no pause).
       * For meditation app, 'doNotMix' is appropriate (user expects focus).
       */
      interruptionMode: 'doNotMix',
    });
  } catch (error) {
    // Warn but don't throw; app can still function with default audio behavior
    console.warn('Failed to configure audio mode:', error);
  }
}

/**
 * Enable or disable audio globally.
 * Affects all active audio players in the app.
 * Use for pause-all, resume-all, or emergency audio shutdown scenarios.
 *
 * @param active - true to enable audio, false to silence/pause
 * @throws Does not throw; logs warning on failure
 */
export async function setAudioActive(active: boolean): Promise<void> {
  try {
    await setIsAudioActiveAsync(active);
  } catch (error) {
    console.warn('Failed to set audio active state:', error);
  }
}
