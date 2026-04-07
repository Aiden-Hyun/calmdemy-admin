/**
 * ============================================================
 * SleepTimerContext.tsx — Sleep Timer Management with Fade-Out
 *                         (State Machine + Observer Pattern)
 * ============================================================
 *
 * Architectural Role:
 *   Manages a countdown timer for meditation sessions. When the timer expires,
 *   it automatically fades out the audio over ~10 seconds, then pauses playback.
 *   This prevents jarring silence when a meditation ends — instead, the audio
 *   gently fades and pauses.
 *
 * Design Patterns:
 *   - Provider Pattern: exposes sleep timer state and actions via useSleepTimer
 *   - State Machine: implicit finite state machine with states (inactive, active,
 *     fading). Actions transition between states.
 *   - Observer Pattern: timer registers an audio player to control volume during fade
 *   - Dependency Injection: audio player is injected via registerAudioPlayer(),
 *     not imported. This decouples the timer from the player implementation.
 *
 * Key Implementation Details:
 *   - Uses refs (intervalRef, fadeIntervalRef, audioPlayerRef) to manage timers
 *     and the registered audio player without causing re-renders.
 *   - Fade-out is a separate interval: linearly interpolates volume from 1.0 to 0
 *     over 100 steps at 100ms intervals (totaling ~10 seconds).
 *   - originalVolumeRef stores the player's initial volume so we can restore it
 *     if the user cancels the timer mid-fade.
 *
 * Consumed By:
 *   - MediaPlayer (registers itself via registerAudioPlayer)
 *   - SleepTimerScreen (displays remaining time, lets user cancel/extend)
 * ============================================================
 */

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

interface SleepTimerContextType {
  // --- State ---
  isActive: boolean;
  remainingSeconds: number;
  selectedDuration: number | null; // in seconds
  isFadingOut: boolean;

  // --- Actions ---
  startTimer: (durationSeconds: number) => void;
  cancelTimer: () => void;
  extendTimer: (additionalSeconds: number) => void;

  // --- Dependency Injection: audio player registration ---
  // Called by MediaPlayer to inject the audio control interface
  registerAudioPlayer: (player: { setVolume: (volume: number) => void; pause: () => void }) => void;
  unregisterAudioPlayer: () => void;
}

const SleepTimerContext = createContext<SleepTimerContextType | undefined>(undefined);

/**
 * SleepTimerProvider component — manages countdown timer with automatic fade-out.
 */
export function SleepTimerProvider({ children }: { children: React.ReactNode }) {
  // --- State: Timer status ---
  const [isActive, setIsActive] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [isFadingOut, setIsFadingOut] = useState(false);

  // --- Refs: Timers and registered player ---
  // These are refs, not state, because:
  // 1. We don't want changes to these to trigger re-renders
  // 2. We need to access them in interval callbacks and cleanup functions
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPlayerRef = useRef<{ setVolume: (volume: number) => void; pause: () => void } | null>(null);
  const originalVolumeRef = useRef(1.0);  // Stores initial volume for restoration on cancel

  /**
   * Effect: Cleanup timers on component unmount.
   *
   * This ensures that if the SleepTimerProvider unmounts (e.g., app closes),
   * both the countdown interval and fade interval are cleared. Otherwise,
   * setInterval callbacks could fire after unmount and cause React warnings.
   *
   * Empty dependency array: runs once on unmount only.
   */
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }
    };
  }, []);

  /**
   * Action: Perform the fade-out effect when timer expires.
   *
   * This is extracted to a separate function because it's called from two places:
   * 1. When the countdown interval reaches 0 (automatic)
   * 2. Potentially from a manual "fade now" action in the future
   *
   * Fade strategy: linear interpolation of volume from 1.0 to 0 over 100 steps
   * at 100ms intervals. This gives ~10 seconds of smooth fade-out, which feels
   * natural to the user.
   *
   * State machine: transitions from "active countdown" to "fading out" to "inactive".
   */
  const performFadeOut = useCallback(() => {
    if (!audioPlayerRef.current) {
      // No audio player registered, just deactivate without fading
      setIsActive(false);
      setRemainingSeconds(0);
      setSelectedDuration(null);
      return;
    }

    setIsFadingOut(true);

    // Fade out over ~10 seconds using linear interpolation
    const fadeSteps = 100;
    const fadeInterval = 100; // ms per step
    let currentStep = 0;

    fadeIntervalRef.current = setInterval(() => {
      currentStep++;
      // Linear fade: volume = 1 - (progress from 0 to 1)
      // Math.max(0, ...) prevents volume from going slightly negative due to rounding
      const newVolume = Math.max(0, 1 - (currentStep / fadeSteps));

      if (audioPlayerRef.current) {
        audioPlayerRef.current.setVolume(newVolume);
      }

      // Check if fade is complete
      if (currentStep >= fadeSteps) {
        // Fade complete: pause audio and clean up state
        if (fadeIntervalRef.current) {
          clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }

        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          // Restore original volume so next playback starts at full volume
          audioPlayerRef.current.setVolume(originalVolumeRef.current);
        }

        // Reset timer state
        setIsFadingOut(false);
        setIsActive(false);
        setRemainingSeconds(0);
        setSelectedDuration(null);
      }
    }, fadeInterval);
  }, []);

  /**
   * Action: Start a countdown timer.
   *
   * This cancels any existing timer first (preventing multiple timers running
   * simultaneously), then sets up a new countdown interval that decrements
   * remainingSeconds by 1 every second (1000ms).
   *
   * When the timer reaches 1 second, we clear the interval and call performFadeOut()
   * to start the fade-out and pause sequence. The check `if (prev <= 1)` is used
   * instead of `if (prev === 1)` to handle potential edge cases where the
   * interval timing drifts.
   */
  const startTimer = useCallback((durationSeconds: number) => {
    // Clean up any existing timers (allow only one timer at a time)
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
    }

    // Initialize timer state
    setSelectedDuration(durationSeconds);
    setRemainingSeconds(durationSeconds);
    setIsActive(true);
    setIsFadingOut(false);

    // Start the countdown interval: decrement every 1 second
    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          // Timer expired: clear interval and trigger fade-out
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          performFadeOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [performFadeOut]);

  /**
   * Action: Cancel the timer and restore audio to original state.
   *
   * This stops both the countdown and fade intervals, and restores the audio
   * volume if we were in the middle of a fade. This is called when the user
   * taps "Cancel" on the timer screen, or when they start a new timer.
   */
  const cancelTimer = useCallback(() => {
    // Clear both intervals
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }

    // Restore volume if we were mid-fade
    if (isFadingOut && audioPlayerRef.current) {
      audioPlayerRef.current.setVolume(originalVolumeRef.current);
    }

    // Reset all timer state
    setIsActive(false);
    setRemainingSeconds(0);
    setSelectedDuration(null);
    setIsFadingOut(false);
  }, [isFadingOut]);

  /**
   * Action: Add time to an active timer.
   *
   * Called when the user taps the "+" button to extend the timer. Both
   * remainingSeconds (the countdown value) and selectedDuration (the original
   * duration, for display) are incremented. This only works if the timer
   * is currently active.
   */
  const extendTimer = useCallback((additionalSeconds: number) => {
    if (isActive) {
      setRemainingSeconds((prev) => prev + additionalSeconds);
      setSelectedDuration((prev) => (prev || 0) + additionalSeconds);
    }
  }, [isActive]);

  /**
   * Action: Register an audio player for fade-out control.
   *
   * This is Dependency Injection: the timer doesn't create or import an audio
   * player; instead, the MediaPlayer component calls this method to register
   * itself. The timer can then call player.setVolume() and player.pause()
   * during the fade-out sequence.
   *
   * @param player - Object with setVolume and pause methods
   */
  const registerAudioPlayer = useCallback((player: { setVolume: (volume: number) => void; pause: () => void }) => {
    audioPlayerRef.current = player;
    // Save the current volume so we can restore it if timer is cancelled
    originalVolumeRef.current = 1.0; // Assume full volume on registration
  }, []);

  /**
   * Action: Unregister the audio player (cleanup).
   *
   * Called by MediaPlayer when it unmounts or is no longer the active player.
   */
  const unregisterAudioPlayer = useCallback(() => {
    audioPlayerRef.current = null;
  }, []);

  return (
    <SleepTimerContext.Provider
      value={{
        isActive,
        remainingSeconds,
        selectedDuration,
        isFadingOut,
        startTimer,
        cancelTimer,
        extendTimer,
        registerAudioPlayer,
        unregisterAudioPlayer,
      }}
    >
      {children}
    </SleepTimerContext.Provider>
  );
}

/**
 * Custom hook: useSleepTimer — access timer state and actions.
 *
 * @throws Error if used outside a SleepTimerProvider
 * @returns SleepTimerContextType with state (isActive, remainingSeconds, etc.)
 *          and actions (startTimer, cancelTimer, extendTimer, registerAudioPlayer)
 */
export function useSleepTimer() {
  const context = useContext(SleepTimerContext);
  if (!context) {
    throw new Error('useSleepTimer must be used within a SleepTimerProvider');
  }
  return context;
}

/**
 * Utility: format seconds into MM:SS display format.
 *
 * Helper function for UI components to display remaining time. Extracted to a
 * standalone function (not in the hook) so it can be used anywhere without
 * needing the context.
 *
 * @param seconds - Number of seconds (e.g., 125)
 * @returns Formatted string (e.g., "2:05")
 */
export function formatTimerDisplay(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
