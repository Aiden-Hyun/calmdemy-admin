/**
 * Breathing Exercise Hook - Guided Breath Timing Engine
 *
 * ARCHITECTURAL ROLE:
 * Mid-level ViewModel hook that orchestrates timed breathing exercises using a pattern-driven
 * state machine. Guides users through structured breathing cycles (inhale-hold-exhale-pause)
 * with real-time progress tracking and completion callbacks.
 *
 * DESIGN PATTERNS:
 * - State Machine: Phases (inhale->hold->exhale->pause->inhale) transition on timer completion
 * - Frame-Based Animation: requestAnimationFrame for smooth 60fps progress UI updates
 * - Callback Lifecycle: Triggers onCycleComplete (each breath) and onComplete (exercise done)
 * - Timer Cleanup: Careful management of setInterval and requestAnimationFrame refs
 *
 * KEY RESPONSIBILITIES:
 * 1. Parse breathing pattern (4-4-4-4 means 4s inhale, 4s hold, 4s exhale, 4s pause)
 * 2. Drive state transitions at phase boundaries
 * 3. Calculate progress within phase (0-100% for progress bar)
 * 4. Track total cycles completed and trigger completion callbacks
 * 5. Handle pause/resume with accurate time tracking
 *
 * CONSUMERS:
 * - Breathing exercise screens: Display phase instructions and progress circles
 * - Wellness features: Breathing as supplement to meditation
 * - ViewModel hooks: May wrap this for user session tracking
 *
 * DEPENDENCIES:
 * - React hooks: useState, useEffect, useRef, useCallback
 * - BreathingPattern type: Defines exhale_duration, inhale_duration, etc.
 *
 * IMPORTANT NOTES:
 * - Phase timing is critical for UX - must match audio cues if narrated
 * - Both setInterval (phase transitions) and requestAnimationFrame (progress UI) active
 *   during exercise - ensure cleanup on unmount to prevent memory leaks
 * - Resume logic recalculates phaseStartTime based on progress to continue smoothly
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { BreathingPattern } from '@/types';

type BreathingPhase = 'inhale' | 'hold' | 'exhale' | 'pause' | 'idle';

interface UseBreathingOptions {
  pattern: BreathingPattern;
  onCycleComplete?: () => void;
  onComplete?: () => void;
}

/**
 * useBreathing Hook
 *
 * Orchestrates guided breathing exercises with timed phases and progress tracking.
 *
 * @param pattern Breathing pattern defining durations of inhale/hold/exhale/pause phases
 * @param onCycleComplete Optional callback fired after each complete breath cycle
 * @param onComplete Optional callback fired when all cycles complete
 * @returns Object with breathing state (currentPhase, progress, timeRemaining) and control methods
 */
export function useBreathing({ pattern, onCycleComplete, onComplete }: UseBreathingOptions) {
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<BreathingPhase>('idle');
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [currentCycle, setCurrentCycle] = useState(0);
  const [phaseTimeRemaining, setPhaseTimeRemaining] = useState(0);
  
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  /**
   * LOCAL STATE FOR EXERCISE TRACKING
   * isActive: User started exercise (true until complete/stop)
   * isPaused: Exercise paused mid-session (can resume)
   * currentPhase: 'idle' until start, then cycles through 'inhale'->'hold'->'exhale'->'pause'
   * phaseProgress: 0-100% completion within current phase (for progress circle/bar)
   * currentCycle: Which breath cycle we're on (0-indexed)
   * phaseTimeRemaining: Seconds left in current phase (for countdown display)
   */
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<BreathingPhase>('idle');
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [currentCycle, setCurrentCycle] = useState(0);
  const [phaseTimeRemaining, setPhaseTimeRemaining] = useState(0);

  /**
   * TIMER REFERENCES
   * intervalRef: setTimeout handle for phase transitions (not setInterval to avoid drift)
   * phaseStartTimeRef: Capture exact Date.now() when phase starts (for accurate elapsed tracking)
   * animationFrameRef: requestAnimationFrame ID for smooth progress updates (60fps UI)
   *
   * Using refs prevents closure stale-value issues when callbacks depend on changing state.
   */
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  /**
   * CALCULATE TOTAL CYCLE DURATION (derived state, not stored)
   * Sum all four phase durations to determine exercise length.
   * Recalculated when pattern changes (user selects different breathing rhythm).
   *
   * Example: 4-4-4-4 pattern = 4+4+4+4 = 16 seconds per cycle
   */
  const cycleDuration =
    pattern.inhale_duration +
    (pattern.hold_duration || 0) +
    pattern.exhale_duration +
    (pattern.pause_duration || 0);

  /**
   * GET PHASE DURATION HELPER (useCallback)
   * Map phase name -> duration from pattern.
   * Decouples phase logic from pattern object (allows pattern parameter changes).
   *
   * DEPENDENCY: [pattern] - Recreate if user switches breathing pattern mid-exercise
   */
  const getCurrentPhaseDuration = useCallback((phase: BreathingPhase): number => {
    switch (phase) {
      case 'inhale':
        return pattern.inhale_duration;
      case 'hold':
        return pattern.hold_duration || 0;
      case 'exhale':
        return pattern.exhale_duration;
      case 'pause':
        return pattern.pause_duration || 0;
      default:
        return 0;
    }
  }, [pattern]);

  /**
   * GET NEXT PHASE HELPER (useCallback)
   * Drive phase state machine forward. Implements cycle: inhale -> [hold] -> exhale -> [pause] -> inhale
   *
   * NON-OBVIOUS LOGIC:
   * - hold phase only appears if pattern.hold_duration exists (skip if 0)
   * - pause phase only appears if pattern.pause_duration exists
   * Example: 4-0-4-0 pattern (no hold/pause) = inhale->exhale->inhale (skips hold/pause)
   * Example: 4-4-4-0 pattern (hold but no pause) = inhale->hold->exhale->inhale
   *
   * DEPENDENCY: [pattern] - Recreate if pattern changes
   */
  const getNextPhase = useCallback((current: BreathingPhase): BreathingPhase => {
    switch (current) {
      case 'inhale':
        return pattern.hold_duration ? 'hold' : 'exhale';
      case 'hold':
        return 'exhale';
      case 'exhale':
        return pattern.pause_duration ? 'pause' : 'inhale';
      case 'pause':
        return 'inhale';
      default:
        return 'inhale';
    }
  }, [pattern]);

  /**
   * SMOOTH PROGRESS UPDATES (useCallback, called from requestAnimationFrame)
   * Runs 60fps to calculate smooth progress within current phase.
   * Uses requestAnimationFrame instead of setInterval for jank-free animation.
   *
   * CALCULATION:
   * 1. elapsed = (now - phaseStartTimeRef) / 1000 -> seconds since phase start
   * 2. progress = (elapsed / phaseDuration) * 100 -> normalize to 0-100%
   * 3. timeRemaining = phaseDuration - elapsed -> for countdown displays
   *
   * GUARD CONDITIONS:
   * - Skip if !isActive (exercise not running)
   * - Skip if isPaused (timer paused, don't update UI)
   * - Skip if currentPhase === 'idle' (hasn't started)
   *
   * RECURSIVE: Schedules next frame with requestAnimationFrame(updateProgress)
   * This creates continuous 60fps loop while active.
   *
   * DEPENDENCY: [isActive, isPaused, currentPhase, getCurrentPhaseDuration]
   * Recreate when any of these change (guards condition changed).
   */
  const updateProgress = useCallback(() => {
    if (!isActive || isPaused || currentPhase === 'idle') return;

    const now = Date.now();
    const elapsed = (now - phaseStartTimeRef.current) / 1000;
    const phaseDuration = getCurrentPhaseDuration(currentPhase);

    if (phaseDuration > 0) {
      // Clamp progress to [0, 100] - don't show >100% if elapsed > duration
      const progress = Math.min((elapsed / phaseDuration) * 100, 100);
      setPhaseProgress(progress);
      // Time remaining can't be negative - show 0 when phase ends
      setPhaseTimeRemaining(Math.max(0, phaseDuration - elapsed));
    }

    // Schedule next frame - creates continuous 60fps loop
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  }, [isActive, isPaused, currentPhase, getCurrentPhaseDuration]);

  /**
   * ANIMATION LOOP LIFECYCLE (useEffect)
   * Start requestAnimationFrame loop when exercise active, cancel when paused/idle.
   *
   * CLEANUP FUNCTION:
   * Cancels pending animation frame on unmount or when active/paused state changes.
   * Prevents updateProgress from running after component unmounts (React memory leak warning).
   *
   * DEPENDENCY: [isActive, isPaused, currentPhase, updateProgress]
   * Restart loop when any of these change (guard conditions for updateProgress).
   */
  useEffect(() => {
    if (isActive && !isPaused && currentPhase !== 'idle') {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, isPaused, currentPhase, updateProgress]);

  /**
   * PHASE TRANSITION LOGIC (useCallback)
   * Move to next phase, check for cycle/exercise completion, call callbacks.
   *
   * CYCLE COMPLETION DETECTION:
   * After 'exhale' (if no pause) or 'pause' (if pause exists), increment cycle counter.
   * If onCycleComplete callback exists, fire it (used for audio cues, UI feedback).
   * Example: 4-4-4-4 pattern = complete cycle every 16 seconds
   *
   * EXERCISE COMPLETION DETECTION:
   * When currentCycle >= pattern.cycles - 1 (last cycle), check if transitioning away from
   * final phase (exhale or pause). If so, call complete() which fires onComplete callback.
   *
   * NON-OBVIOUS CHECKS:
   * - currentCycle < pattern.cycles: Guards against incrementing beyond total cycles
   * - Check both exhale and pause conditions: depends on whether pattern has pause phase
   *
   * DEPENDENCY: [currentPhase, currentCycle, pattern, getNextPhase, onCycleComplete]
   * Recreate when any change (phase state machine driving this callback).
   */
  const transitionToNextPhase = useCallback(() => {
    const nextPhase = getNextPhase(currentPhase);
    
    // Check if we completed a cycle
    if (currentPhase === 'exhale' && !pattern.pause_duration && currentCycle < pattern.cycles) {
      setCurrentCycle(c => c + 1);
      if (onCycleComplete) onCycleComplete();
    } else if (currentPhase === 'pause' && currentCycle < pattern.cycles) {
      setCurrentCycle(c => c + 1);
      if (onCycleComplete) onCycleComplete();
    }

    // Check if exercise is complete
    if (currentCycle >= pattern.cycles - 1 && 
        ((currentPhase === 'exhale' && !pattern.pause_duration) || currentPhase === 'pause')) {
      complete();
      return;
    }

    // Transition to next phase
    setCurrentPhase(nextPhase);
    setPhaseProgress(0);
    // Capture exact timestamp when new phase starts (for updateProgress elapsed calculation)
    phaseStartTimeRef.current = Date.now();
  }, [currentPhase, currentCycle, pattern, getNextPhase, onCycleComplete]);

  /**
   * PHASE TIMER (useEffect)
   * Schedule phase transition when current phase duration elapses.
   *
   * TWO BEHAVIORS:
   * 1. If phaseDuration > 0: setTimeout for duration, then transitionToNextPhase
   * 2. If phaseDuration === 0: Skip phase immediately (transitionToNextPhase instantly)
   *    This handles patterns with optional hold/pause phases that user didn't select
   *
   * CLEANUP FUNCTION:
   * Cancels pending setTimeout if dependencies change (e.g., phase changed before timer fired).
   * Prevents transition firing for stale phase.
   *
   * DEPENDENCY: [isActive, isPaused, currentPhase, getCurrentPhaseDuration, transitionToNextPhase]
   * Restart timer when phase changes or active state changes.
   */
  useEffect(() => {
    if (isActive && !isPaused && currentPhase !== 'idle') {
      const phaseDuration = getCurrentPhaseDuration(currentPhase);
      
      if (phaseDuration > 0) {
        intervalRef.current = setTimeout(() => {
          transitionToNextPhase();
        }, phaseDuration * 1000);
      } else {
        // Skip phases with 0 duration
        transitionToNextPhase();
      }
    }

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
  }, [isActive, isPaused, currentPhase, getCurrentPhaseDuration, transitionToNextPhase]);

  /**
   * START ACTION (useCallback)
   * Begin breathing exercise from idle state.
   *
   * INITIAL STATE:
   * - isActive: true (exercise running)
   * - isPaused: false (not paused)
   * - currentPhase: 'inhale' (start with inhale phase)
   * - currentCycle: 0 (first cycle, 0-indexed)
   * - phaseProgress: 0 (beginning of phase)
   * - phaseStartTimeRef: Now (for elapsed calculation)
   *
   * CALL SITE:
   * Component renders "Start" button, user taps, calls start()
   */
  const start = useCallback(() => {
    setIsActive(true);
    setIsPaused(false);
    setCurrentPhase('inhale');
    setCurrentCycle(0);
    setPhaseProgress(0);
    phaseStartTimeRef.current = Date.now();
  }, []);

  /**
   * PAUSE ACTION (useCallback)
   * Pause exercise mid-breath. Timer and animation loop stop but state preserved.
   * User can later call resume() to continue from same phase/progress.
   */
  const pause = useCallback(() => {
    setIsPaused(true);
  }, []);

  /**
   * RESUME ACTION (useCallback)
   * Unpause and continue exercise from where it was paused.
   *
   * RECALCULATE PHASE START TIME:
   * When paused, phaseProgress was frozen at, say, 50%. To resume smoothly:
   * 1. currentPhase and phaseProgress unchanged
   * 2. Recalculate phaseStartTimeRef so elapsed time reflects progress
   *    newPhaseStartTime = now - (progress / 100 * phaseDuration)
   * Example: 50% through 4-second phase = 2 seconds elapsed
   *          newPhaseStartTime = now - 2000ms
   *          updateProgress will now show 50% progress when it recalculates
   *
   * This ensures smooth animation continuation without time jumping.
   */
  const resume = useCallback(() => {
    setIsPaused(false);
    phaseStartTimeRef.current = Date.now() - (phaseProgress / 100 * getCurrentPhaseDuration(currentPhase) * 1000);
  }, [currentPhase, phaseProgress, getCurrentPhaseDuration]);

  /**
   * STOP ACTION (useCallback)
   * End exercise and reset to idle state.
   *
   * CLEANUP:
   * - Clears both interval (phase timer) and animationFrame (progress loop)
   * - Resets all state to initial values
   * - Allows user to restart with start()
   */
  const stop = useCallback(() => {
    setIsActive(false);
    setIsPaused(false);
    setCurrentPhase('idle');
    setPhaseProgress(0);
    setCurrentCycle(0);
    setPhaseTimeRemaining(0);
    
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  /**
   * COMPLETE ACTION (useCallback)
   * Exercise finished (all cycles done). Fire onComplete callback, then stop.
   *
   * CALLBACK PATTERN:
   * Parent component passed onComplete(sessionId) to track meditation session stats.
   * Before cleanup, fire callback so parent can save user progress.
   *
   * DEPENDENCY: [onComplete, stop]
   */
  const complete = useCallback(() => {
    if (onComplete) onComplete();
    stop();
  }, [onComplete, stop]);

  /**
   * GET INSTRUCTIONS (useCallback)
   * Return human-readable instruction for current phase.
   * Used to display "Breathe in", "Hold", "Breathe out", "Pause" text on screen.
   *
   * DEPENDENCY: [currentPhase]
   */
  const getInstructions = useCallback((): string => {
    switch (currentPhase) {
      case 'inhale':
        return 'Breathe in';
      case 'hold':
        return 'Hold';
      case 'exhale':
        return 'Breathe out';
      case 'pause':
        return 'Pause';
      default:
        return 'Ready to begin';
    }
  }, [currentPhase]);

  /**
   * RETURN VALUE - Clean interface for breathing exercise screens
   *
   * STATE:
   * - isActive: Exercise running (false = idle or complete)
   * - isPaused: Paused within exercise (user can resume)
   * - currentPhase: Which breathing phase ('inhale'/'hold'/'exhale'/'pause'/'idle')
   * - phaseProgress: 0-100% through current phase (for progress circles)
   * - currentCycle: Which breath cycle (0-indexed)
   * - totalCycles: Total cycles from pattern
   * - phaseTimeRemaining: Seconds left in phase (for countdown)
   * - instructions: Human text like "Breathe in" or "Hold"
   * - cycleDuration: Total seconds per breath cycle
   *
   * ACTIONS:
   * - start(): Begin exercise
   * - pause(): Pause mid-exercise
   * - resume(): Continue from pause
   * - stop(): Cancel exercise and reset
   */
  return {
    isActive,
    isPaused,
    currentPhase,
    phaseProgress,
    currentCycle,
    totalCycles: pattern.cycles,
    phaseTimeRemaining,
    instructions: getInstructions(),
    cycleDuration,
    start,
    pause,
    resume,
    stop,
  };
}
