import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

interface SleepTimerContextType {
  // State
  isActive: boolean;
  remainingSeconds: number;
  selectedDuration: number | null; // in seconds
  isFadingOut: boolean;
  
  // Actions
  startTimer: (durationSeconds: number) => void;
  cancelTimer: () => void;
  extendTimer: (additionalSeconds: number) => void;
  
  // For fade-out effect - called by MediaPlayer
  registerAudioPlayer: (player: { setVolume: (volume: number) => void; pause: () => void }) => void;
  unregisterAudioPlayer: () => void;
}

const SleepTimerContext = createContext<SleepTimerContextType | undefined>(undefined);

export function SleepTimerProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [isFadingOut, setIsFadingOut] = useState(false);
  
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPlayerRef = useRef<{ setVolume: (volume: number) => void; pause: () => void } | null>(null);
  const originalVolumeRef = useRef(1.0);

  // Cleanup on unmount
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

  const performFadeOut = useCallback(() => {
    if (!audioPlayerRef.current) {
      // No audio player registered, just stop
      setIsActive(false);
      setRemainingSeconds(0);
      setSelectedDuration(null);
      return;
    }

    setIsFadingOut(true);
    
    // Fade out over 10 seconds (100 steps, every 100ms)
    const fadeSteps = 100;
    const fadeInterval = 100; // ms
    let currentStep = 0;
    
    fadeIntervalRef.current = setInterval(() => {
      currentStep++;
      const newVolume = Math.max(0, 1 - (currentStep / fadeSteps));
      
      if (audioPlayerRef.current) {
        audioPlayerRef.current.setVolume(newVolume);
      }
      
      if (currentStep >= fadeSteps) {
        // Fade complete - pause audio and reset
        if (fadeIntervalRef.current) {
          clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }
        
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          // Restore original volume for next playback
          audioPlayerRef.current.setVolume(originalVolumeRef.current);
        }
        
        setIsFadingOut(false);
        setIsActive(false);
        setRemainingSeconds(0);
        setSelectedDuration(null);
      }
    }, fadeInterval);
  }, []);

  const startTimer = useCallback((durationSeconds: number) => {
    // Cancel any existing timer
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
    }
    
    setSelectedDuration(durationSeconds);
    setRemainingSeconds(durationSeconds);
    setIsActive(true);
    setIsFadingOut(false);
    
    // Start countdown
    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          // Timer complete
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          // Trigger fade out
          performFadeOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [performFadeOut]);

  const cancelTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }
    
    // Restore volume if we were fading
    if (isFadingOut && audioPlayerRef.current) {
      audioPlayerRef.current.setVolume(originalVolumeRef.current);
    }
    
    setIsActive(false);
    setRemainingSeconds(0);
    setSelectedDuration(null);
    setIsFadingOut(false);
  }, [isFadingOut]);

  const extendTimer = useCallback((additionalSeconds: number) => {
    if (isActive) {
      setRemainingSeconds((prev) => prev + additionalSeconds);
      setSelectedDuration((prev) => (prev || 0) + additionalSeconds);
    }
  }, [isActive]);

  const registerAudioPlayer = useCallback((player: { setVolume: (volume: number) => void; pause: () => void }) => {
    audioPlayerRef.current = player;
  }, []);

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

export function useSleepTimer() {
  const context = useContext(SleepTimerContext);
  if (!context) {
    throw new Error('useSleepTimer must be used within a SleepTimerProvider');
  }
  return context;
}

// Helper to format seconds to MM:SS
export function formatTimerDisplay(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
