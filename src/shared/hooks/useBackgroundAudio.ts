import { useCallback, useState, useEffect, useRef } from "react";
import {
  useAudioPlayer as useExpoAudioPlayer,
  useAudioPlayerStatus,
  AudioSource,
} from "expo-audio";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEYS = {
  SELECTED_SOUND: "bg_audio_selected_sound",
  VOLUME: "bg_audio_volume",
  ENABLED: "bg_audio_enabled",
};

export interface BackgroundAudioState {
  isPlaying: boolean;
  isLoading: boolean;
  selectedSoundId: string | null;
  volume: number;
  isEnabled: boolean;
}

/**
 * Hook for managing background ambient audio that plays alongside main content
 */
export function useBackgroundAudio() {
  const [selectedSoundId, setSelectedSoundId] = useState<string | null>(null);
  const [loadingSoundId, setLoadingSoundId] = useState<string | null>(null);
  const [readySoundId, setReadySoundId] = useState<string | null>(null); // Track which sound is actually ready
  const [volume, setVolumeState] = useState(0.3); // Default 30% volume
  const [isEnabled, setIsEnabled] = useState(true);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [loadStartTime, setLoadStartTime] = useState<number | null>(null);

  // Create audio player instance
  const player = useExpoAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  // Load saved preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      try {
        const [savedSoundId, savedVolume, savedEnabled] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.SELECTED_SOUND),
          AsyncStorage.getItem(STORAGE_KEYS.VOLUME),
          AsyncStorage.getItem(STORAGE_KEYS.ENABLED),
        ]);

        if (savedSoundId) {
          setSelectedSoundId(savedSoundId);
        }
        if (savedVolume) {
          setVolumeState(parseFloat(savedVolume));
        }
        if (savedEnabled !== null) {
          setIsEnabled(savedEnabled === "true");
        }
        setIsInitialized(true);
      } catch (err) {
        console.warn("Failed to load background audio preferences:", err);
        setIsInitialized(true);
      }
    }
    loadPreferences();
  }, []);

  // Load audio when URL changes
  useEffect(() => {
    if (currentAudioUrl && isEnabled) {
      try {
        const source: AudioSource = { uri: currentAudioUrl };
        player.replace(source);
        player.loop = true;
        player.volume = volume;
      } catch (err) {
        console.warn("Failed to load background audio:", err);
      }
    }
  }, [currentAudioUrl, isEnabled]);

  // Update volume when it changes
  useEffect(() => {
    try {
      player.volume = volume;
    } catch (err) {
      // Ignore
    }
  }, [volume, player]);

  // Track the URL we're loading to detect when it changes
  const loadingUrlRef = useRef<string | null>(null);
  
  // Load audio by URL with immediate stop of previous audio
  const loadAudio = useCallback(
    (url: string, soundId: string) => {
      // Stop current audio immediately
      try {
        player.pause();
      } catch (err) {
        // Ignore
      }
      
      // Reset states for new sound loading
      setHasError(false);
      setReadySoundId(null); // Clear ready state - new sound not ready yet
      setLoadingSoundId(soundId);
      setLoadStartTime(Date.now());
      loadingUrlRef.current = url;
      setCurrentAudioUrl(url);
    },
    [player]
  );
  
  // Clear loading state when audio is loaded and not buffering
  useEffect(() => {
    if (loadingSoundId && status.isLoaded && !status.isBuffering && currentAudioUrl === loadingUrlRef.current) {
      // Small delay to ensure audio is truly ready
      const timer = setTimeout(() => {
        const soundIdToReady = loadingSoundId;
        setLoadingSoundId(null);
        setReadySoundId(soundIdToReady); // Mark THIS specific sound as ready
        loadingUrlRef.current = null;
        setLoadStartTime(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [status.isLoaded, status.isBuffering, loadingSoundId, currentAudioUrl]);

  // Track current readySoundId for timeout check
  const readySoundIdRef = useRef<string | null>(null);
  useEffect(() => {
    readySoundIdRef.current = readySoundId;
  }, [readySoundId]);

  // Detect load timeout (if loading takes more than 8 seconds without becoming ready, assume error)
  useEffect(() => {
    // Start timeout when we have a selected sound that's not ready yet
    if (selectedSoundId && !readySoundId && !hasError && currentAudioUrl) {
      const targetSoundId = selectedSoundId;
      const timer = setTimeout(() => {
        // Check if this sound is still not ready (use ref for current value)
        if (readySoundIdRef.current !== targetSoundId) {
          // If still not ready after 8 seconds, mark as error
          setHasError(true);
          setLoadingSoundId(null);
          setLoadStartTime(null);
        }
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [selectedSoundId, readySoundId, hasError, currentAudioUrl]);

  // Select a sound and persist choice (without loading audio yet)
  const selectSound = useCallback(
    async (soundId: string | null) => {
      // Stop current audio immediately when changing sounds
      try {
        player.pause();
      } catch (err) {
        // Ignore
      }
      
      setSelectedSoundId(soundId);
      if (!soundId) {
        setCurrentAudioUrl(null);
        setLoadingSoundId(null);
      }

      try {
        if (soundId) {
          await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_SOUND, soundId);
        } else {
          await AsyncStorage.removeItem(STORAGE_KEYS.SELECTED_SOUND);
        }
      } catch (err) {
        console.warn("Failed to save sound preference:", err);
      }
    },
    [player]
  );

  // Set volume and persist
  const setVolume = useCallback(async (newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    try {
      player.volume = clampedVolume;
      await AsyncStorage.setItem(STORAGE_KEYS.VOLUME, clampedVolume.toString());
    } catch (err) {
      console.warn("Failed to save volume preference:", err);
    }
  }, [player]);

  // Toggle enabled state and persist
  const setEnabled = useCallback(async (enabled: boolean) => {
    setIsEnabled(enabled);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ENABLED, enabled.toString());
      if (!enabled) {
        player.pause();
      }
    } catch (err) {
      console.warn("Failed to save enabled preference:", err);
    }
  }, [player]);

  // Play background audio
  const play = useCallback(() => {
    if (!isEnabled || !currentAudioUrl) return;
    try {
      player.loop = true;
      player.volume = volume;
      player.play();
    } catch (err) {
      console.warn("Failed to play background audio:", err);
    }
  }, [player, isEnabled, currentAudioUrl, volume]);

  // Pause background audio
  const pause = useCallback(() => {
    try {
      player.pause();
    } catch (err) {
      console.warn("Failed to pause background audio:", err);
    }
  }, [player]);

  // Stop and reset
  const stop = useCallback(() => {
    try {
      player.pause();
      player.seekTo(0);
    } catch (err) {
      console.warn("Failed to stop background audio:", err);
    }
  }, [player]);

  // Cleanup
  const cleanup = useCallback(() => {
    try {
      player.pause();
    } catch (err) {
      // Ignore cleanup errors
    }
  }, [player]);

  // Audio is ready only when THE SELECTED SOUND has been loaded and confirmed ready
  // This prevents showing checkmark from stale audio state
  const isAudioReady = readySoundId !== null && readySoundId === selectedSoundId && !hasError;

  // Determine if the selected sound should show as loading
  // It's loading if: we have a selected sound AND it's not ready yet AND no error
  const isSelectedSoundLoading = selectedSoundId !== null && !isAudioReady && !hasError;

  const state: BackgroundAudioState = {
    isPlaying: status.playing,
    isLoading: !status.isLoaded || status.isBuffering,
    selectedSoundId,
    volume,
    isEnabled,
  };

  return {
    // State
    ...state,
    isInitialized,
    hasAudioLoaded: !!currentAudioUrl && isAudioReady,
    loadingSoundId: isSelectedSoundLoading ? selectedSoundId : loadingSoundId, // Which sound is currently loading
    isAudioReady, // Whether the audio is actually loaded and ready to play
    hasError, // Whether audio failed to load

    // Actions
    selectSound,
    loadAudio,
    setVolume,
    setEnabled,
    play,
    pause,
    stop,
    cleanup,
  };
}
