/**
 * Meditation Session Hook - Timer & Stats Tracking
 *
 * ARCHITECTURAL ROLE:
 * Mid-level ViewModel hook that orchestrates meditation session timing and persistence.
 * Tracks elapsed time, handles app background/foreground transitions, and persists
 * session to Firebase when complete. Different from useAudioPlayer (playback engine)
 * and useMeditation is about session tracking and timing.
 *
 * DESIGN PATTERNS:
 * - App State Observer: Listens to AppState changes (background/foreground)
 * - Background Time Adjustment: Accounts for elapsed time while app backgrounded
 * - Interval-Based Timer: Simple setInterval for 1-second ticks
 * - Session Persistence: createSession() call on completion (Firebase write)
 *
 * KEY RESPONSIBILITIES:
 * 1. Initialize timer from duration parameter (minutes -> seconds)
 * 2. Decrement counter each second while active
 * 3. Track app background transitions and adjust timer
 * 4. Persist session to database on completion
 * 5. Provide formatted time and progress percentage to UI
 *
 * CONSUMERS:
 * - Meditation detail screens: Display time remaining and progress
 * - Completion flow: Receives sessionId for stats/achievement tracking
 * - Session history: Database query returns all MeditationSession records
 *
 * DEPENDENCIES:
 * - React hooks: useState, useEffect, useRef, useCallback
 * - AppState: React Native lifecycle for background detection
 * - profileRepository: Firebase session persistence
 * - AuthContext: User ID for session ownership
 *
 * IMPORTANT NOTES:
 * - Timer accuracy degrades if app backgrounded (relies on AppState to adjust)
 * - Actual duration may differ from requested duration (user can pause/resume)
 * - Only persists session after user completes or explicitly finishes
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { createSession } from '@features/profile/data/profileRepository';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { MeditationSession } from '@/types';

interface UseMeditationOptions {
  duration: number; // in minutes
  sessionType: 'meditation' | 'breathing' | 'nature_sound' | 'bedtime_story';
  onComplete?: (sessionId: string) => void;
}

/**
 * useMeditation Hook
 *
 * Manage meditation session timer and persistence to database.
 *
 * @param duration Session duration in minutes
 * @param sessionType Category (meditation/breathing/nature_sound/bedtime_story)
 * @param onComplete Optional callback with sessionId when session completes
 * @returns Object with timer state (timeRemaining, progress), control methods (start/pause/resume/stop/complete)
 *
 * USAGE EXAMPLE:
 *   const session = useMeditation({ duration: 10, sessionType: 'meditation' });
 *   session.start();
 *   // Later (by audio player): <Text>{session.formattedTime}</Text>
 *   // On completion: complete() is called via useEffect, fires onComplete callback
 */
export function useMeditation({ duration, sessionType, onComplete }: UseMeditationOptions) {
  const { user } = useAuth();

  /**
   * LOCAL TIMER STATE
   * isActive: Session running (false = stopped)
   * isPaused: Session paused mid-meditation (can resume)
   * timeRemaining: Seconds left in session (decrements 1/second)
   * progress: 0-100% of session completed (for progress bar)
   */
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(duration * 60); // Convert to seconds
  const [progress, setProgress] = useState(0);

  /**
   * TIMER REFERENCES
   * intervalRef: setInterval ID for 1-second timer ticks
   * startTimeRef: Timestamp when session started (Date.now())
   * pausedTimeRef: Timestamp when user paused (Date.now())
   * appStateRef: Current app state (active/background/inactive)
   *
   * Using refs instead of state prevents closure stale-value bugs in callbacks.
   */
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  /**
   * APP STATE LISTENER (useEffect, no dependencies)
   * Detect when app goes to background and returns to foreground.
   * Adjust timer to account for elapsed time while backgrounded.
   *
   * SCENARIO:
   * 1. User starts 10-minute meditation, 5 minutes elapsed
   * 2. Gets phone call, app backgrounded, call ends after 2 minutes
   * 3. User returns to app - timeRemaining should show 3 minutes left (5+2=7 elapsed)
   *
   * BACKGROUND DETECTION LOGIC:
   * When transitioning from inactive/background -> active:
   * - Calculate elapsed = Date.now() - pausedTimeRef (time spent in background)
   * - Subtract from timeRemaining
   * - If timeRemaining <= 0, complete the session
   * This makes timer continue counting while app backgrounded.
   *
   * PATTERN: This is similar to how Slack's voice recording timer works.
   *
   * CLEANUP: Remove listener on unmount.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        isActive &&
        !isPaused
      ) {
        // App came to foreground while timer was running
        const elapsedWhileInBackground = Date.now() - pausedTimeRef.current;
        const newTimeRemaining = Math.max(0, timeRemaining - Math.floor(elapsedWhileInBackground / 1000));
        setTimeRemaining(newTimeRemaining);
        
        if (newTimeRemaining === 0) {
          complete();
        }
      } else if (nextAppState.match(/inactive|background/) && isActive && !isPaused) {
        // App going to background while timer is running
        pausedTimeRef.current = Date.now();
      }
      
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isActive, isPaused, timeRemaining]);

  /**
   * INTERVAL TIMER (useEffect)
   * Decrement timeRemaining by 1 second when active and not paused.
   *
   * BEHAVIOR:
   * 1. If isActive && !isPaused && timeRemaining > 0:
   *    - setInterval decrements by 1 each second
   *    - Calculate progress% from elapsed / total
   *    - If timeRemaining reaches 0, call complete()
   * 2. Otherwise:
   *    - Clear existing interval
   *    - No timer running
   *
   * CLEANUP:
   * Clears interval on unmount or when active/paused state changes.
   * Prevents orphaned intervals continuing after component unmounts.
   *
   * DEPENDENCY: [isActive, isPaused, timeRemaining, duration]
   * Recreate when active state changes (pause/resume toggles this).
   */
  useEffect(() => {
    if (isActive && !isPaused && timeRemaining > 0) {
      intervalRef.current = setInterval(() => {
        setTimeRemaining((time) => {
          // Prevent negative time, clamp to 0
          const newTime = Math.max(0, time - 1);
          const totalSeconds = duration * 60;
          // Calculate how much time has elapsed since start
          const elapsed = totalSeconds - newTime;
          // Progress is elapsed / total, as percentage
          setProgress((elapsed / totalSeconds) * 100);

          // When timer hits zero, trigger completion
          if (newTime === 0) {
            complete();
          }

          return newTime;
        });
      }, 1000); // 1000ms = 1 second tick
    } else {
      // If not active, clear any running timer
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      // Cleanup: cancel timer on unmount or state change
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, isPaused, timeRemaining, duration]);

  /**
   * START ACTION (useCallback)
   * Begin meditation session from stopped state.
   *
   * INITIAL STATE:
   * - isActive: true (timer running)
   * - isPaused: false (not paused)
   * - startTimeRef: Date.now() (for background detection)
   *
   * DEPENDENCY: [] (none)
   */
  const start = useCallback(() => {
    setIsActive(true);
    setIsPaused(false);
    startTimeRef.current = Date.now();
  }, []);

  /**
   * PAUSE ACTION (useCallback)
   * Pause timer mid-session. User can resume later.
   * Capture current timestamp for background adjustment logic.
   */
  const pause = useCallback(() => {
    setIsPaused(true);
    pausedTimeRef.current = Date.now();
  }, []);

  /**
   * RESUME ACTION (useCallback)
   * Unpause and continue timer. Adjust startTimeRef so elapsed time tracking stays accurate.
   * When paused, pausedTimeRef was set. Now calculate how long pause lasted and extend start time.
   *
   * MATH:
   * pauseDuration = Date.now() - pausedTimeRef
   * startTimeRef += pauseDuration
   * This shifts the "elapsed = now - startTime" calculation forward to skip pause time.
   */
  const resume = useCallback(() => {
    setIsPaused(false);
    const pauseDuration = Date.now() - pausedTimeRef.current;
    startTimeRef.current += pauseDuration;
  }, []);

  /**
   * STOP ACTION (useCallback)
   * Cancel session and reset to initial state. Timer cleared.
   * This does NOT persist session (use complete() for that).
   */
  const stop = useCallback(() => {
    setIsActive(false);
    setIsPaused(false);
    setTimeRemaining(duration * 60);
    setProgress(0);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [duration]);

  /**
   * COMPLETE ACTION (useCallback, async)
   * Session finished. Save session record to Firestore and fire onComplete callback.
   *
   * BEHAVIOR:
   * 1. Calculate actualDuration = (scheduled_duration - timeRemaining) / 60
   *    This is how long user actually meditated (accounts for pauses)
   * 2. Create session record in Firebase with actual duration, type, user ID
   * 3. Fire onComplete(sessionId) callback so screen can navigate to completion flow
   * 4. Call stop() to reset timer
   *
   * ERROR HANDLING:
   * If Firebase write fails, error is logged but doesn't crash. onComplete still fires
   * so UI doesn't freeze. Session might be recorded twice on retry.
   *
   * DEPENDENCY: [user, duration, timeRemaining, sessionType, onComplete, stop]
   */
  const complete = useCallback(async () => {
    if (!user) return;

    // Calculate how many minutes user actually meditated (rounded up)
    // Example: scheduled 10 min (600s), stopped at 5 min remaining (300s)
    // actualDuration = (600 - 300) / 60 = 5 minutes
    const actualDuration = Math.ceil((duration * 60 - timeRemaining) / 60);

    try {
      // Save session to Firestore for stats and achievement tracking
      const sessionId = await createSession({
        user_id: user.uid,
        duration_minutes: actualDuration,
        session_type: sessionType,
      });

      // Notify parent screen that session saved (proceed to completion flow)
      if (onComplete) {
        onComplete(sessionId);
      }
    } catch (error) {
      console.error('Failed to save meditation session:', error);
    }

    // Reset timer state
    stop();
  }, [user, duration, timeRemaining, sessionType, onComplete, stop]);

  /**
   * FORMAT TIME (useCallback)
   * Convert seconds to "mm:ss" display format.
   * Used by UI to show time remaining in meditation.
   *
   * DEFENSIVE PROGRAMMING:
   * - padStart(2, "0") ensures "0:05" not "0:5"
   * - Math.floor prevents fractional seconds
   *
   * DEPENDENCY: [] (pure function)
   */
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  /**
   * RETURN VALUE - Clean interface for meditation screens
   *
   * STATE:
   * - isActive: Session running
   * - isPaused: Paused within session
   * - timeRemaining: Seconds left in session
   * - progress: 0-100% completed
   * - formattedTime: "mm:ss" display string
   *
   * ACTIONS:
   * - start(): Begin meditation
   * - pause(): Pause mid-session
   * - resume(): Continue from pause
   * - stop(): Cancel session (doesn't persist)
   * - complete(): End and persist to database
   */
  return {
    isActive,
    isPaused,
    timeRemaining,
    progress,
    formattedTime: formatTime(timeRemaining),
    start,
    pause,
    resume,
    stop,
    complete,
  };
}
