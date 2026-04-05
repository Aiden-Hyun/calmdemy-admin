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

export function useMeditation({ duration, sessionType, onComplete }: UseMeditationOptions) {
  const { user } = useAuth();
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(duration * 60); // Convert to seconds
  const [progress, setProgress] = useState(0);
  
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Handle app state changes (background/foreground)
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

  // Timer logic
  useEffect(() => {
    if (isActive && !isPaused && timeRemaining > 0) {
      intervalRef.current = setInterval(() => {
        setTimeRemaining((time) => {
          const newTime = Math.max(0, time - 1);
          const totalSeconds = duration * 60;
          const elapsed = totalSeconds - newTime;
          setProgress((elapsed / totalSeconds) * 100);
          
          if (newTime === 0) {
            complete();
          }
          
          return newTime;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, isPaused, timeRemaining, duration]);

  const start = useCallback(() => {
    setIsActive(true);
    setIsPaused(false);
    startTimeRef.current = Date.now();
  }, []);

  const pause = useCallback(() => {
    setIsPaused(true);
    pausedTimeRef.current = Date.now();
  }, []);

  const resume = useCallback(() => {
    setIsPaused(false);
    const pauseDuration = Date.now() - pausedTimeRef.current;
    startTimeRef.current += pauseDuration;
  }, []);

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

  const complete = useCallback(async () => {
    if (!user) return;

    const actualDuration = Math.ceil((duration * 60 - timeRemaining) / 60);
    
    try {
      const sessionId = await createSession({
        user_id: user.uid,
        duration_minutes: actualDuration,
        session_type: sessionType,
      });

      if (onComplete) {
        onComplete(sessionId);
      }
    } catch (error) {
      console.error('Failed to save meditation session:', error);
    }

    stop();
  }, [user, duration, timeRemaining, sessionType, onComplete, stop]);

  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

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
