import { useState, useEffect, useRef, useCallback } from 'react';
import { BreathingPattern } from '@/types';

type BreathingPhase = 'inhale' | 'hold' | 'exhale' | 'pause' | 'idle';

interface UseBreathingOptions {
  pattern: BreathingPattern;
  onCycleComplete?: () => void;
  onComplete?: () => void;
}

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

  // Calculate total cycle duration
  const cycleDuration = 
    pattern.inhale_duration + 
    (pattern.hold_duration || 0) + 
    pattern.exhale_duration + 
    (pattern.pause_duration || 0);

  // Get current phase duration
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

  // Get next phase
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

  // Animation loop for smooth progress updates
  const updateProgress = useCallback(() => {
    if (!isActive || isPaused || currentPhase === 'idle') return;

    const now = Date.now();
    const elapsed = (now - phaseStartTimeRef.current) / 1000;
    const phaseDuration = getCurrentPhaseDuration(currentPhase);
    
    if (phaseDuration > 0) {
      const progress = Math.min((elapsed / phaseDuration) * 100, 100);
      setPhaseProgress(progress);
      setPhaseTimeRemaining(Math.max(0, phaseDuration - elapsed));
    }

    animationFrameRef.current = requestAnimationFrame(updateProgress);
  }, [isActive, isPaused, currentPhase, getCurrentPhaseDuration]);

  // Start animation loop when active
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

  // Phase transition logic
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
    phaseStartTimeRef.current = Date.now();
  }, [currentPhase, currentCycle, pattern, getNextPhase, onCycleComplete]);

  // Timer for phase transitions
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

  const start = useCallback(() => {
    setIsActive(true);
    setIsPaused(false);
    setCurrentPhase('inhale');
    setCurrentCycle(0);
    setPhaseProgress(0);
    phaseStartTimeRef.current = Date.now();
  }, []);

  const pause = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    setIsPaused(false);
    phaseStartTimeRef.current = Date.now() - (phaseProgress / 100 * getCurrentPhaseDuration(currentPhase) * 1000);
  }, [currentPhase, phaseProgress, getCurrentPhaseDuration]);

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

  const complete = useCallback(() => {
    if (onComplete) onComplete();
    stop();
  }, [onComplete, stop]);

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
