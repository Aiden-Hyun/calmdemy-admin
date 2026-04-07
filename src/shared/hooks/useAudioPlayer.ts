/**
 * Audio Player Hook - Core Audio Playback Engine
 *
 * ARCHITECTURAL ROLE:
 * Low-level ViewModel hook that wraps expo-audio with a React-friendly interface.
 * Provides unified playback control and state management for all audio content in the app
 * (meditations, stories, background music, sleep sounds). This is a foundational hook
 * consumed by higher-level features like useBackgroundAudio and usePlayerBehavior.
 *
 * DESIGN PATTERNS:
 * - Adapter Pattern: Adapts native expo-audio API to React Hook idioms
 * - State Aggregation: Combines multiple expo-audio status fields into clean interface
 * - Memoization Heavy: Uses useMemo and useCallback to prevent unnecessary re-renders
 *   in consuming components (important for smooth playback UI)
 * - Audio Mode Configuration: Configures OS-level audio behavior on mount
 *
 * KEY RESPONSIBILITIES:
 * 1. Audio mode setup (silent mode, background playback, interception mode)
 * 2. Source resolution (string URLs -> AudioSource objects)
 * 3. Playback control (play, pause, seek, skip, speed)
 * 4. State derivation (duration, progress, formatted time)
 * 5. Error handling with user-friendly messages
 *
 * DEPENDENCIES:
 * - expo-audio: Native audio playback engine
 * - React Hooks: State management and effect scheduling
 *
 * CONSUMERS:
 * - useBackgroundAudio: Ambient sound playback
 * - usePlayerBehavior: User interactions (play/pause, skip)
 * - Meditation detail screens: Primary playback control
 * - Sleep story screens: Long-form content playback
 *
 * IMPORTANT NOTES:
 * - Single instance per component - do not use in multiple components without coordination
 * - Audio continues in background (shouldPlayInBackground: true) - requires proper pause/cleanup
 * - updateInterval: 250ms balances smooth progress UI with CPU efficiency
 */

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  useAudioPlayer as useExpoAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  AudioSource,
} from "expo-audio";

/**
 * Audio player state interface for consuming components
 * Aggregates player status and derived UI state into clean contract
 */
export interface AudioPlayerState {
  isPlaying: boolean;           // Currently playing (not paused)
  isLoading: boolean;           // Loading or buffering (not isLoaded OR isBuffering)
  duration: number;             // Total duration in seconds
  position: number;             // Current playback position in seconds (currentTime)
  progress: number;             // Normalized progress 0-1 for progress bars
  formattedPosition: string;     // "mm:ss" formatted current position
  formattedDuration: string;     // "mm:ss" formatted total duration
  error: string | null;         // Human-readable error message or null
  isLooping: boolean;           // Whether track loops on completion
  playbackRate: number;         // Current playback speed (0.5-2.0)
}

/**
 * Internal helper: Resolve audio source to expo-audio AudioSource format
 *
 * Adapts multiple input types to standard AudioSource interface:
 * - string URLs: Wrapped as { uri: url }
 * - require() results: Passed through as-is (local bundle assets)
 * - null: Returns null for no-op scenarios
 *
 * This abstraction allows callers to use intuitive string paths while
 * maintaining compatibility with local assets and expo-audio's native format.
 *
 * @param source String URL, require() number, or null
 * @returns Normalized AudioSource or null if source is falsy
 */
function resolveAudioSource(
  source: string | number | null
): AudioSource | null {
  if (!source) return null;

  // If it's a URL string, wrap it in { uri: ... } format expected by expo-audio
  if (typeof source === "string") {
    return { uri: source };
  }

  // Assume it's a require() result (number) from bundle - pass through
  // This maintains backwards compatibility with local asset references
  return source;
}

/**
 * useAudioPlayer Hook
 *
 * Low-level audio playback ViewModel providing play/pause/seek controls and state management.
 * Wraps expo-audio with React idioms and UI-friendly state derivation.
 *
 * @param initialSource Optional: string URL or require() reference to load on mount
 * @returns Object with audio state, control methods, and raw player instance for advanced use
 *
 * USAGE EXAMPLE:
 *   const player = useAudioPlayer('https://example.com/meditation.mp3');
 *   // Later:
 *   player.loadAudio(newUrl);
 *   player.play();
 *   return <ProgressBar value={player.progress} />;
 *
 * CLEANUP RESPONSIBILITY:
 * Calling component should invoke player.cleanup() in useEffect cleanup to pause audio
 * when component unmounts. This prevents audio continuing after navigation.
 */
export function useAudioPlayer(initialSource?: string | number | null) {
  // Local state for properties not exposed by expo-audio
  const [error, setError] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const hasLoadedRef = useRef(false);

  /**
   * AUDIO MODE CONFIGURATION (useEffect, no dependencies)
   * Runs once on hook mount to configure OS-level audio behavior.
   *
   * Configuration details:
   * - playsInSilentMode: true - Play meditation even when phone is silent
   * - shouldPlayInBackground: true - Continue playback when user switches apps
   * - interruptionMode: 'doNotMix' - Pause when system audio plays (calls, alarms)
   *   This prevents jarring overlapping audio instead of mixing
   * - setIsAudioActiveAsync: Explicitly request Android audio focus (prevents
   *   other apps from simultaneously playing audio)
   *
   * SIDE EFFECT:
   * This configuration persists for the entire app session. Consider moving to
   * app initialization (RootProvider) if multiple audio contexts needed.
   */
  useEffect(() => {
    async function configureAudio() {
      try {
        // Configure how this audio player interacts with OS-level audio
        await setAudioModeAsync({
          playsInSilentMode: true,         // Ignore device silent switch
          shouldPlayInBackground: true,    // Continue in background
          shouldRouteThroughEarpiece: false, // Use speaker, not earpiece
          // 'doNotMix' ensures audio pauses when other apps play audio (calls, notifications)
          interruptionMode: 'doNotMix',
        });
        // Explicitly request audio focus on Android (prevents simultaneous playback)
        const { setIsAudioActiveAsync } = await import("expo-audio");
        await setIsAudioActiveAsync(true);
      } catch (err) {
        console.warn("Failed to configure audio mode:", err);
      }
    }
    configureAudio();
    // Empty dependency array: configure once on mount only
  }, []);

  /**
   * INITIAL SOURCE RESOLUTION (useMemo, empty deps)
   * Resolve and memoize initial audio source once on mount.
   * Empty dependency array ensures this runs exactly once (initial mount only).
   * Later source changes use loadAudio() method instead.
   */
  const initialResolvedSource = useMemo(
    () => resolveAudioSource(initialSource ?? null),
    [] // Empty array: memoize once, ignore subsequent initialSource changes
  );

  /**
   * EXPO-AUDIO PLAYER INSTANCE
   * Create native audio player with initial source.
   * updateInterval: 250ms balances smooth progress UI updates with CPU efficiency
   * (lower = more responsive but more CPU, higher = less responsive but efficient)
   */
  const player = useExpoAudioPlayer(initialResolvedSource, {
    updateInterval: 250, // Update progress UI 4x per second
  });

  /**
   * PLAYER STATUS SUBSCRIPTION (Observer pattern)
   * useAudioPlayerStatus subscribes to player status changes and returns latest state.
   * This is a React Query-like observer - component re-renders on status changes.
   * Provides: playing, isLoaded, isBuffering, currentTime, duration, etc.
   */
  const status = useAudioPlayerStatus(player);

  /**
   * TIME FORMATTING UTILITY (useCallback)
   * Memoized formatting function to prevent recreation on every render.
   * Used by UI to display "2:35 / 10:00" style progress.
   *
   * DEFENSIVE PROGRAMMING:
   * - isFinite check prevents "NaN:NaN" if status values are invalid
   * - padStart(2, "0") ensures "0:05" not "0:5"
   *
   * MEMOIZATION RATIONALE:
   * Function is passed to useMemo dependency arrays below.
   * useCallback prevents re-memoization on every render.
   */
  const formatTime = useCallback((seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  /**
   * DERIVED STATE MEMOIZATION (useMemo)
   * Aggregate raw expo-audio status into clean UI state interface.
   * Memoization prevents creating new objects on every render, which would
   * cause unnecessary re-renders in child components subscribed to this state.
   *
   * DERIVATIONS:
   * - isLoading: true if not loaded OR currently buffering (either means "show spinner")
   * - progress: normalized 0-1 value for progress bars (prevents division-by-zero)
   * - formattedPosition/Duration: "mm:ss" strings for UI display (uses formatTime)
   *
   * DEPENDENCY ARRAY:
   * [status, error, formatTime, isLooping, playbackRate]
   * Object is recreated only when any of these change. This prevents spurious
   * re-renders from useCallback/useMemo invalidations elsewhere.
   */
  const audioState: AudioPlayerState = useMemo(
    () => ({
      isPlaying: status.playing,
      isLoading: !status.isLoaded || status.isBuffering,
      duration: status.duration,
      position: status.currentTime,
      progress: status.duration > 0 ? status.currentTime / status.duration : 0, // Normalize to 0-1
      formattedPosition: formatTime(status.currentTime),
      formattedDuration: formatTime(status.duration),
      error,
      isLooping,
      playbackRate,
    }),
    [status, error, formatTime, isLooping, playbackRate] // Recreate when any input changes
  );

  /**
   * LOAD AUDIO (useCallback action)
   * Replace current audio source with new URL/file.
   * Used when user selects different meditation, story, or music.
   *
   * BEHAVIOR:
   * - Clears previous error state
   * - Resolves source (string URL -> AudioSource)
   * - Calls player.replace() to load new source (doesn't auto-play)
   * - Sets volume to 1.0 (full) to ensure audio isn't muted
   *
   * SIDE EFFECT:
   * Does NOT auto-play. Calling component must invoke play() separately.
   * This gives UI control over playback timing (e.g., show loading state).
   *
   * ERROR HANDLING:
   * Try-catch wraps entire operation. Errors are stored in state and
   * displayed to user. User is not surprised by silent load failures.
   *
   * DEPENDENCY: [player]
   * Recreated when player instance changes (shouldn't happen in practice).
   */
  const loadAudio = useCallback(
    async (source: string | number) => {
      try {
        setError(null); // Clear stale errors from previous load attempt
        const resolved = resolveAudioSource(source);
        if (resolved) {
          player.replace(resolved);  // Load but don't auto-play
          player.volume = 1.0;        // Ensure not muted
          hasLoadedRef.current = true; // Track that we've loaded audio at least once
        }
      } catch (err) {
        console.error("Failed to load audio:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load audio";
        setError(errorMessage); // Display error to user
      }
    },
    [player] // Recreate if player instance changes
  );

  /**
   * PLAY CONTROL (useCallback)
   * Start audio playback from current position.
   *
   * SAFETY MEASURES:
   * - Sets volume=1.0 (in case muted elsewhere)
   * - Sets muted=false (unmutes before playing)
   * - Wrapped in try-catch to prevent crashes on device-specific audio failures
   *
   * NO-OP IF NO AUDIO LOADED:
   * If loadAudio() hasn't been called, this is a no-op (player is null).
   * Calling component should check loadAudio() completed before calling play().
   *
   * DEPENDENCY: [player]
   */
  const play = useCallback(async () => {
    try {
      player.volume = 1.0;    // Ensure audible volume
      player.muted = false;   // Unmute before playing
      player.play();          // Start playback
    } catch (err) {
      console.warn("Failed to play:", err);
      // Don't set error state here - temporary/recoverable failure
    }
  }, [player]);

  /**
   * PAUSE CONTROL (useCallback)
   * Pause audio at current position.
   * Playback can resume from same position via play().
   *
   * DEPENDENCY: [player]
   */
  const pause = useCallback(async () => {
    try {
      player.pause();
    } catch (err) {
      console.warn("Failed to pause:", err);
    }
  }, [player]);

  /**
   * STOP CONTROL (useCallback)
   * Pause and reset position to beginning.
   * Next play() will start from 0:00.
   *
   * STATE MACHINE:
   * play -> pause -> play (resumes mid-track)
   * play -> pause -> stop -> play (restarts from beginning)
   *
   * DEPENDENCY: [player]
   */
  const stop = useCallback(async () => {
    try {
      player.pause();        // Stop playback
      player.seekTo(0);      // Reset to start
    } catch (err) {
      console.warn("Failed to stop:", err);
    }
  }, [player]);

  /**
   * SEEK CONTROL (useCallback)
   * Jump to specific position in audio (in seconds).
   * Used by progress bar scrubbing and skip buttons.
   *
   * PARAMETER: position in seconds
   * UI should validate: 0 <= position <= duration
   *
   * DEPENDENCY: [player]
   */
  const seekTo = useCallback(
    async (position: number) => {
      try {
        player.seekTo(position);
      } catch (err) {
        console.warn("Failed to seek:", err);
      }
    },
    [player]
  );

  /**
   * VOLUME CONTROL (useCallback)
   * Set audio playback volume (0.0 = silent, 1.0 = full volume).
   *
   * CLAMPING:
   * Math.max(0, Math.min(1, volume)) ensures 0 <= volume <= 1
   * Prevents invalid values from crashing player or producing unexpected behavior.
   *
   * DEPENDENCY: [player]
   */
  const setVolume = useCallback(
    (volume: number) => {
      try {
        player.volume = Math.max(0, Math.min(1, volume)); // Clamp to [0, 1]
      } catch (err) {
        console.warn("Failed to set volume:", err);
      }
    },
    [player]
  );

  /**
   * LOOP CONTROL (useCallback)
   * Enable/disable track looping.
   * When enabled, track replays from beginning on completion.
   *
   * STATE SYNC:
   * Sets both player.loop AND local isLooping state so audioState reflects change.
   * This is necessary because status subscription doesn't always reflect loop state.
   *
   * USE CASE:
   * White noise and ambient sounds often loop all night.
   * Meditations and stories typically don't loop.
   *
   * DEPENDENCY: [player]
   */
  const setLoop = useCallback(
    (loop: boolean) => {
      try {
        player.loop = loop;
        setIsLooping(loop); // Sync local state with player
      } catch (err) {
        console.warn("Failed to set loop:", err);
      }
    },
    [player]
  );

  /**
   * PLAYBACK RATE CONTROL (useCallback)
   * Adjust playback speed for time-shifting (0.5x slow, 2.0x fast).
   *
   * VALID RANGE: 0.5 to 2.0 (50% to 200% speed)
   *
   * CLAMPING LOGIC:
   * 1. Math.max(0.5, Math.min(2.0, rate)) - Clamp to [0.5, 2.0]
   * 2. * 10 / 10 - Round to 0.1 increments (prevents floating point errors)
   *   Example: rate=1.25 -> Math.round(12.5)*10 = 12*10 = 1.2
   *
   * PITCH CORRECTION:
   * player.setPlaybackRate(rate, 'high') applies pitch correction to maintain
   * voice natural at different speeds (important for narrative content like stories).
   * Without this, 1.5x speed would sound like chipmunks!
   *
   * USE CASE:
   * Power users might speed up meditations (1.25x) when in a hurry.
   * Never slow down (0.5x) increases meditation duration.
   *
   * DEPENDENCY: [player]
   */
  const setPlaybackRate = useCallback(
    (rate: number) => {
      try {
        // Clamp rate to [0.5, 2.0] and round to 0.1 increments
        const clampedRate = Math.round(Math.max(0.5, Math.min(2.0, rate)) * 10) / 10;
        // 'high' pitch correction maintains voice quality at different playback speeds
        player.setPlaybackRate(clampedRate, 'high');
        setPlaybackRateState(clampedRate); // Sync local state
      } catch (err) {
        console.warn("Failed to set playback rate:", err);
      }
    },
    [player]
  );

  /**
   * SKIP FORWARD (useCallback)
   * Jump forward by N seconds (default 15 seconds, typical for podcast apps).
   *
   * BOUNDS CHECKING:
   * Math.min(newPosition, duration) prevents skipping past end.
   * If at 9:50 and duration is 10:00, skip forward 15s goes to 10:00, not 10:05.
   *
   * DEFAULT: 15 seconds (podcast convention)
   * Can override: skipForward(30) for 30-second skip
   *
   * UI INTEGRATION:
   * Typically bound to ">>" button on media player controls.
   *
   * DEPENDENCY: [player, status.currentTime, status.duration]
   * Recreated when current time or duration changes (necessary for bounds check).
   * This is slightly aggressive memoization - consider optimizing if performance issue.
   */
  const skipForward = useCallback(
    (seconds: number = 15) => {
      try {
        const newPosition = Math.min(status.currentTime + seconds, status.duration);
        player.seekTo(newPosition);
      } catch (err) {
        console.warn("Failed to skip forward:", err);
      }
    },
    [player, status.currentTime, status.duration]
  );

  /**
   * SKIP BACKWARD (useCallback)
   * Jump backward by N seconds (default 15 seconds).
   *
   * BOUNDS CHECKING:
   * Math.max(newPosition, 0) prevents seeking before start.
   * If at 0:10 and skip backward 15s, goes to 0:00, not negative time.
   *
   * USE CASE:
   * User missed something and wants to re-hear last phrase.
   * Common for educational content like meditation instruction.
   *
   * DEPENDENCY: [player, status.currentTime]
   * Only depends on current time (duration not needed for backward check).
   */
  const skipBackward = useCallback(
    (seconds: number = 15) => {
      try {
        const newPosition = Math.max(status.currentTime - seconds, 0);
        player.seekTo(newPosition);
      } catch (err) {
        console.warn("Failed to skip backward:", err);
      }
    },
    [player, status.currentTime]
  );

  /**
   * CLEANUP FUNCTION (useCallback)
   * Pause audio when component unmounts.
   * Should be called in useEffect cleanup to prevent audio continuing after navigation.
   *
   * EXAMPLE USAGE IN COMPONENT:
   *   useEffect(() => {
   *     return () => audioPlayer.cleanup();  // Pause on unmount
   *   }, [audioPlayer.cleanup]);
   *
   * CALLED BY: Consuming component's cleanup, or usePlayerBehavior on screen exit
   *
   * DEPENDENCY: [player]
   * Recreated if player instance changes.
   */
  const cleanup = useCallback(() => {
    try {
      player.pause();
    } catch (err) {
      // Ignore cleanup errors - best effort pause
    }
  }, [player]);

  /**
   * RETURN VALUE - Clean interface for consuming components
   *
   * STATE (spread audioState):
   * - isPlaying, isLoading, duration, position, progress
   * - formattedPosition, formattedDuration
   * - error, isLooping, playbackRate
   *
   * ACTIONS (control methods):
   * - loadAudio(source): Load new audio without playing
   * - play(): Start playback
   * - pause(): Pause playback
   * - stop(): Pause and reset to beginning
   * - seekTo(seconds): Jump to position
   * - setVolume(0-1): Adjust volume
   * - setLoop(boolean): Enable/disable repeat
   * - setPlaybackRate(0.5-2.0): Speed adjustment
   * - skipForward(seconds): Jump ahead (default 15s)
   * - skipBackward(seconds): Jump back (default 15s)
   * - cleanup(): Pause on unmount
   *
   * ESCAPE HATCH:
   * - player: Raw expo-audio player instance for advanced use
   *   (avoid if possible - prefer using exposed actions above)
   */
  return {
    // State properties (spread from audioState)
    ...audioState,

    // Action methods
    loadAudio,
    play,
    pause,
    stop,
    seekTo,
    setVolume,
    setLoop,
    setPlaybackRate,
    skipForward,
    skipBackward,
    cleanup,

    // Raw player instance for advanced/custom use (escape hatch)
    player,
  };
}
