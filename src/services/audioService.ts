/**
 * Audio Service - Utility functions for audio configuration
 * 
 * Note: For audio playback, use the useAudioPlayer hook from '@shared/hooks/useAudioPlayer'
 * which wraps expo-audio's functionality.
 */

import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

export interface AudioState {
  isPlaying: boolean;
  isLoading: boolean;
  duration: number;
  position: number;
  error: string | null;
}

/**
 * Configure the global audio mode for the app
 */
export async function configureAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
      // 'doNotMix' ensures audio pauses when other apps play audio
      interruptionMode: 'doNotMix',
    });
  } catch (error) {
    console.warn('Failed to configure audio mode:', error);
  }
}

/**
 * Enable or disable audio globally
 */
export async function setAudioActive(active: boolean): Promise<void> {
  try {
    await setIsAudioActiveAsync(active);
  } catch (error) {
    console.warn('Failed to set audio active state:', error);
  }
}
