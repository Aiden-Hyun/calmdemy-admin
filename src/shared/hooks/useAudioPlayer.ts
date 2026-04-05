import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  useAudioPlayer as useExpoAudioPlayer,
  useAudioPlayerStatus,
  setAudioModeAsync,
  AudioSource,
} from "expo-audio";

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  duration: number;
  position: number;
  progress: number;
  formattedPosition: string;
  formattedDuration: string;
  error: string | null;
  isLooping: boolean;
  playbackRate: number;
}

/**
 * Resolve a source (URL string or require() result) to an AudioSource
 */
function resolveAudioSource(
  source: string | number | null
): AudioSource | null {
  if (!source) return null;

  // If it's a URL string, wrap it in { uri: ... }
  if (typeof source === "string") {
    return { uri: source };
  }

  // Already a require() result (number) - this shouldn't happen with remote URLs
  // but keep for backwards compatibility
  return source;
}

/**
 * Custom hook that wraps expo-audio's useAudioPlayer with additional utilities
 */
export function useAudioPlayer(initialSource?: string | number | null) {
  const [error, setError] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const hasLoadedRef = useRef(false);

  // Configure audio mode on mount
  useEffect(() => {
    async function configureAudio() {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          shouldRouteThroughEarpiece: false,
          // 'doNotMix' ensures audio pauses when other apps play audio
          interruptionMode: 'doNotMix',
        });
        // Also set audio as active to acquire audio focus on Android
        const { setIsAudioActiveAsync } = await import("expo-audio");
        await setIsAudioActiveAsync(true);
      } catch (err) {
        console.warn("Failed to configure audio mode:", err);
      }
    }
    configureAudio();
  }, []);

  // Resolve initial source
  const initialResolvedSource = useMemo(
    () => resolveAudioSource(initialSource ?? null),
    [] // Only compute once
  );

  // Use expo-audio's hook with initial source
  const player = useExpoAudioPlayer(initialResolvedSource, {
    updateInterval: 250,
  });

  // Get status from player
  const status = useAudioPlayerStatus(player);

  // Format time helper
  const formatTime = useCallback((seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Compute derived state
  const audioState: AudioPlayerState = useMemo(
    () => ({
      isPlaying: status.playing,
      isLoading: !status.isLoaded || status.isBuffering,
      duration: status.duration,
      position: status.currentTime,
      progress: status.duration > 0 ? status.currentTime / status.duration : 0,
      formattedPosition: formatTime(status.currentTime),
      formattedDuration: formatTime(status.duration),
      error,
      isLooping,
      playbackRate,
    }),
    [status, error, formatTime, isLooping, playbackRate]
  );

  // Load a new audio source using player.replace()
  const loadAudio = useCallback(
    async (source: string | number) => {
      try {
        setError(null);
        const resolved = resolveAudioSource(source);
        if (resolved) {
          player.replace(resolved);
          player.volume = 1.0;
          hasLoadedRef.current = true;
        }
      } catch (err) {
        console.error("Failed to load audio:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load audio";
        setError(errorMessage);
      }
    },
    [player]
  );

  // Playback controls
  const play = useCallback(async () => {
    try {
      player.volume = 1.0;
      player.muted = false;
      player.play();
    } catch (err) {
      console.warn("Failed to play:", err);
    }
  }, [player]);

  const pause = useCallback(async () => {
    try {
      player.pause();
    } catch (err) {
      console.warn("Failed to pause:", err);
    }
  }, [player]);

  const stop = useCallback(async () => {
    try {
      player.pause();
      player.seekTo(0);
    } catch (err) {
      console.warn("Failed to stop:", err);
    }
  }, [player]);

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

  const setVolume = useCallback(
    (volume: number) => {
      try {
        player.volume = Math.max(0, Math.min(1, volume));
      } catch (err) {
        console.warn("Failed to set volume:", err);
      }
    },
    [player]
  );

  const setLoop = useCallback(
    (loop: boolean) => {
      try {
        player.loop = loop;
        setIsLooping(loop);
      } catch (err) {
        console.warn("Failed to set loop:", err);
      }
    },
    [player]
  );

  // Set playback speed (0.5 to 2.0 in 0.1 increments)
  const setPlaybackRate = useCallback(
    (rate: number) => {
      try {
        const clampedRate = Math.round(Math.max(0.5, Math.min(2.0, rate)) * 10) / 10;
        // expo-audio uses setPlaybackRate method with optional pitch correction
        player.setPlaybackRate(clampedRate, 'high');
        setPlaybackRateState(clampedRate);
      } catch (err) {
        console.warn("Failed to set playback rate:", err);
      }
    },
    [player]
  );

  // Skip forward by N seconds (default 15)
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

  // Skip backward by N seconds (default 15)
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

  const cleanup = useCallback(() => {
    try {
      player.pause();
    } catch (err) {
      // Ignore cleanup errors
    }
  }, [player]);

  return {
    // State
    ...audioState,

    // Actions
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

    // Raw player access if needed
    player,
  };
}
