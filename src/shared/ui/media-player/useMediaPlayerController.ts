/**
 * useMediaPlayerController Hook
 *
 * Architectural Role:
 * Complex controller logic for the media player. Manages:
 * - Playback state (position, duration, autoplay)
 * - Background audio (sleep sounds) integration
 * - Sleep timer fade-out coordination
 * - Audio download state and progress
 * - Playback progress persistence
 * - Narrator photo fetching
 *
 * Design Patterns:
 * - Custom Hook: Encapsulates complex player logic
 * - Effect Choreography: Multiple coordinated useEffect calls
 * - Ref Tracking: Uses refs to avoid stale closures in async operations
 * - Observer Pattern: Integrates multiple context providers
 *
 * Key Dependencies:
 * - useAudioPlayer: Core playback engine
 * - useBackgroundAudio: Background sleep sound management
 * - useSleepTimer: Global timer state + callbacks
 * - useAuth: User authentication for progress saving
 * - useNetwork: Offline/online status
 *
 * Consumed By:
 * - MediaPlayer screen (orchestrates all player sub-components)
 *
 * Complex Behaviors:
 * - Auto-play next track when current completes
 * - Save playback position periodically (10s intervals) and on pause
 * - Restore position on mount (unless skipping restore)
 * - Register with sleep timer for fade-out effect
 * - Handle background audio lifecycle (load, play, pause)
 * - Download state machine with progress tracking
 *
 * Threading Notes:
 * - Uses isMounted flag to prevent state updates after unmount
 * - Ref-based tracking for values that change frequently
 * - 500ms delay after sign-in to allow context updates (RevenueCat timing)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSleepTimer } from "@core/providers/contexts/SleepTimerContext";
import { useAudioPlayer } from "@shared/hooks/useAudioPlayer";
import { useBackgroundAudio } from "@shared/hooks/useBackgroundAudio";
import { getAudioUrlFromPath } from "@/constants/audioFiles";
import {
  getNarratorByName,
  savePlaybackProgress,
  getPlaybackProgress,
  clearPlaybackProgress,
} from "@shared/data/content";
import {
  getSleepSoundById,
  FirestoreSleepSound,
} from "@features/music/data/musicRepository";
import {
  isDownloaded,
  downloadAudio,
  isDownloading as checkIsDownloading,
} from "@/services/downloadService";
import { useAuth } from "@core/providers/contexts/AuthContext";
import { useNetwork } from "@core/providers/contexts/NetworkContext";

/** AsyncStorage key for persisting autoplay user preference */
const AUTOPLAY_KEY = "calmdemy_autoplay_enabled";

interface UseMediaPlayerControllerProps {
  /** Audio player instance from useAudioPlayer hook */
  audioPlayer: ReturnType<typeof useAudioPlayer>;
  /** Content title for progress tracking */
  title: string;
  /** Duration in minutes for progress calculations */
  durationMinutes: number;
  /** Artwork image URL (if available) */
  artworkThumbnailUrl?: string;
  /** Instructor/narrator name */
  instructor?: string;
  /** Instructor photo URL (if available) */
  instructorPhotoUrl?: string;
  /** Whether background audio (sleep sounds) is available */
  enableBackgroundAudio: boolean;
  /** Whether next track is available for autoplay */
  hasNext: boolean;
  /** Callback when autoplay triggers next track */
  onNext?: () => void;
  /** Unique content identifier for download/progress tracking */
  contentId?: string;
  /** Content type for categorization (meditation, course, etc.) */
  contentType?: string;
  /** Download URL (if available) */
  audioUrl?: string;
  /** Parent content ID (for courses/series) */
  parentId?: string;
  /** Parent content title (for series context) */
  parentTitle?: string;
  /** Local file path (for downloaded content) */
  audioPath?: string;
  /** Skip restore flag (true when autoplay triggers from previous track) */
  skipRestore: boolean;
}

export function useMediaPlayerController({
  audioPlayer,
  title,
  durationMinutes,
  artworkThumbnailUrl,
  instructor,
  instructorPhotoUrl,
  enableBackgroundAudio,
  hasNext,
  onNext,
  contentId,
  contentType,
  audioUrl,
  parentId,
  parentTitle,
  audioPath,
  skipRestore,
}: UseMediaPlayerControllerProps) {
  const { user } = useAuth();
  const { isOffline } = useNetwork();
  const sleepTimer = useSleepTimer();
  const backgroundAudio = useBackgroundAudio();
  const {
    selectedSoundId,
    isInitialized: isBackgroundInitialized,
    isEnabled: isBackgroundEnabled,
    hasAudioLoaded,
    loadAudio,
    play: playBackgroundAudio,
    pause: pauseBackgroundAudio,
    cleanup: cleanupBackgroundAudio,
    selectSound,
  } = backgroundAudio;

  // Modal visibility state
  const [showBackgroundPicker, setShowBackgroundPicker] = useState(false);
  const [showSleepTimerPicker, setShowSleepTimerPicker] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Background audio state
  const [currentBackgroundSound, setCurrentBackgroundSound] =
    useState<FirestoreSleepSound | null>(null);

  // Content metadata state
  const [narratorPhotoUrl, setNarratorPhotoUrl] = useState<string | null>(
    instructorPhotoUrl || null
  );

  // Player behavior state
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);

  // Download state machine
  const [isDownloadedState, setIsDownloadedState] = useState(false);
  const [isDownloadingState, setIsDownloadingState] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  /**
   * Refs for avoiding stale closures in async operations and effect cleanup.
   * These are updated in separate effects to maintain current values.
   */
  const hasTriggeredAutoPlay = useRef(false); // Prevent double autoplay
  const lastSaveTime = useRef(0); // For throttling progress saves (10s minimum)
  const hasRestoredPosition = useRef(false); // Restore only once per content
  const onNextRef = useRef(onNext); // Latest onNext callback
  const audioPlayerRef = useRef(audioPlayer); // Latest audio player
  const sleepTimerRef = useRef(sleepTimer); // Latest sleep timer
  const autoPlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For cleanup

  /**
   * Ref Synchronization Effects:
   * These keep refs in sync with their source props. Necessary because refs
   * don't trigger effect dependencies, but we need current values in async
   * callbacks that may run after component unmounts.
   */
  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);

  useEffect(() => {
    audioPlayerRef.current = audioPlayer;
  }, [audioPlayer]);

  useEffect(() => {
    sleepTimerRef.current = sleepTimer;
  }, [sleepTimer]);

  /**
   * Load Autoplay Preference:
   * Restore user's autoplay setting from persistent storage on mount.
   */
  useEffect(() => {
    async function loadAutoPlayPreference() {
      try {
        const stored = await AsyncStorage.getItem(AUTOPLAY_KEY);
        if (stored !== null) {
          setAutoPlayEnabled(stored === "true");
        }
      } catch (error) {
        console.error("Failed to load auto-play preference:", error);
      }
    }
    loadAutoPlayPreference();
  }, []);

  /**
   * Check Download Status:
   * On mount and when content changes, check if it's already downloaded
   * and if a download is currently in progress.
   */
  useEffect(() => {
    async function checkDownloadStatus() {
      if (!contentId) return;
      const downloaded = await isDownloaded(contentId);
      setIsDownloadedState(downloaded);
      setIsDownloadingState(checkIsDownloading(contentId));
    }
    checkDownloadStatus();
  }, [contentId]);

  /**
   * Download Handler:
   * Initiates audio download with progress tracking. Guards against
   * multiple simultaneous downloads and already-downloaded content.
   */
  const handleDownload = useCallback(async () => {
    // Guard: Don't download if missing metadata or already in progress
    if (
      !contentId ||
      !contentType ||
      !audioUrl ||
      isDownloadingState ||
      isDownloadedState
    ) {
      return;
    }

    setIsDownloadingState(true);
    setDownloadProgress(0);

    try {
      const success = await downloadAudio(
        contentId,
        contentType,
        audioUrl,
        {
          title,
          duration_minutes: durationMinutes,
          thumbnailUrl: artworkThumbnailUrl,
          parentId,
          parentTitle,
          audioPath,
        },
        (progress) => setDownloadProgress(progress)
      );

      if (success) {
        setIsDownloadedState(true);
      }
    } catch (error) {
      console.error("Failed to download audio:", error);
    } finally {
      setIsDownloadingState(false);
      setDownloadProgress(0);
    }
  }, [
    audioPath,
    audioUrl,
    artworkThumbnailUrl,
    contentId,
    contentType,
    durationMinutes,
    isDownloadedState,
    isDownloadingState,
    parentId,
    parentTitle,
    title,
  ]);

  /**
   * Toggle Autoplay:
   * Toggle autoplay setting and persist to AsyncStorage.
   */
  const toggleAutoPlay = useCallback(async () => {
    let nextValue = false;
    // Capture the new value in closure
    setAutoPlayEnabled((current) => {
      nextValue = !current;
      return nextValue;
    });
    try {
      // Persist user preference
      await AsyncStorage.setItem(AUTOPLAY_KEY, String(nextValue));
    } catch (error) {
      console.error("Failed to save auto-play preference:", error);
    }
  }, []);

  /**
   * Fetch Narrator Photo:
   * If instructor name is provided but photo URL isn't, fetch from metadata.
   * Uses isMounted flag to prevent state updates after unmount.
   */
  useEffect(() => {
    let isMounted = true;

    async function fetchNarratorPhoto() {
      if (instructor && !instructorPhotoUrl) {
        const narrator = await getNarratorByName(instructor);
        if (isMounted && narrator?.photoUrl) {
          setNarratorPhotoUrl(narrator.photoUrl);
        }
      }
    }

    fetchNarratorPhoto();
    return () => {
      isMounted = false;
    };
  }, [instructor, instructorPhotoUrl]);

  /**
   * Fetch Current Background Sound:
   * When user selects a background sound, fetch its full metadata from Firestore.
   */
  useEffect(() => {
    let isMounted = true;

    async function fetchCurrentSound() {
      if (selectedSoundId) {
        const sound = await getSleepSoundById(selectedSoundId);
        if (isMounted) {
          setCurrentBackgroundSound(sound);
        }
      } else if (isMounted) {
        setCurrentBackgroundSound(null);
      }
    }

    fetchCurrentSound();
    return () => {
      isMounted = false;
    };
  }, [selectedSoundId]);

  /**
   * Load Saved Background Sound Audio:
   * When background audio is initialized and a sound is selected,
   * fetch the audio URL and load it into the background audio player.
   */
  useEffect(() => {
    let isMounted = true;

    async function loadSavedSoundAudio() {
      if (
        enableBackgroundAudio &&
        isBackgroundInitialized &&
        selectedSoundId
      ) {
        const sound = await getSleepSoundById(selectedSoundId);
        if (!isMounted || !sound) {
          return;
        }
        const url = await getAudioUrlFromPath(sound.audioPath);
        if (isMounted && url) {
          loadAudio(url, selectedSoundId);
        }
      }
    }

    loadSavedSoundAudio();
    return () => {
      isMounted = false;
    };
  }, [
    enableBackgroundAudio,
    isBackgroundInitialized,
    loadAudio,
    selectedSoundId,
  ]);

  /**
   * Auto-play Background Audio:
   * Once the background audio is loaded and enabled, start playback.
   * This happens after the URL has been successfully loaded.
   */
  useEffect(() => {
    if (!enableBackgroundAudio) return;
    if (
      isBackgroundEnabled &&
      selectedSoundId &&
      hasAudioLoaded
    ) {
      playBackgroundAudio();
    }
  }, [
    enableBackgroundAudio,
    hasAudioLoaded,
    isBackgroundEnabled,
    playBackgroundAudio,
    selectedSoundId,
  ]);

  /**
   * Cleanup Background Audio on Unmount:
   * Ensure background audio resources are released when player unmounts.
   */
  useEffect(() => {
    return () => {
      cleanupBackgroundAudio();
    };
  }, [cleanupBackgroundAudio]);

  /**
   * Register with Sleep Timer:
   * Subscribe the audio player to sleep timer events.
   * Sleep timer will call these functions for fade-out and pause effects:
   * - setVolume: Gradually reduce volume as timer counts down
   * - pause: Stop playback when timer expires
   */
  useEffect(() => {
    sleepTimerRef.current.registerAudioPlayer({
      setVolume: (volume: number) => {
        if (audioPlayerRef.current.player) {
          audioPlayerRef.current.player.volume = volume;
        }
      },
      pause: () => {
        audioPlayerRef.current.pause();
        pauseBackgroundAudio();
      },
    });

    return () => {
      sleepTimerRef.current.unregisterAudioPlayer();
    };
  }, [pauseBackgroundAudio]);

  /**
   * Reset Autoplay Trigger:
   * When content changes, reset the flag so autoplay can trigger again.
   */
  useEffect(() => {
    hasTriggeredAutoPlay.current = false;
  }, [title]);

  /**
   * Autoplay Next Track:
   * When current track completes (progress >= 99%) and autoplay is enabled,
   * trigger the next track callback with a small delay (500ms) for UX.
   *
   * Guard with hasTriggeredAutoPlay ref to prevent duplicate triggers.
   */
  useEffect(() => {
    if (
      autoPlayEnabled &&
      hasNext &&
      onNextRef.current &&
      audioPlayer.progress >= 0.99 &&        // Nearly complete
      !audioPlayer.isPlaying &&               // Finished playing
      audioPlayer.duration > 0 &&             // Valid duration
      !hasTriggeredAutoPlay.current           // Not already triggered
    ) {
      hasTriggeredAutoPlay.current = true;
      // Small delay for user to notice transition
      autoPlayTimeoutRef.current = setTimeout(() => {
        onNextRef.current?.();
      }, 500);
    }

    return () => {
      if (autoPlayTimeoutRef.current) {
        clearTimeout(autoPlayTimeoutRef.current);
        autoPlayTimeoutRef.current = null;
      }
    };
  }, [
    audioPlayer.duration,
    audioPlayer.isPlaying,
    audioPlayer.progress,
    autoPlayEnabled,
    hasNext,
  ]);

  /**
   * Restore Playback Position:
   * When player mounts, fetch and restore the user's last playback position.
   * Skipped if coming from autoplay (skipRestore = true).
   *
   * Uses polling to wait for audioPlayer.duration to be available before seeking.
   */
  useEffect(() => {
    async function restorePosition() {
      if (!user?.uid || !contentId || hasRestoredPosition.current) return;

      // Skip restore if flagged (e.g., autoplay trigger)
      if (skipRestore) {
        hasRestoredPosition.current = true;
        return;
      }

      const progress = await getPlaybackProgress(user.uid, contentId);
      // Only restore if position > 5 seconds (skip intro threshold)
      if (progress && progress.position_seconds > 5) {
        const checkAndSeek = () => {
          if (audioPlayer.duration > 0) {
            // Duration is available, seek to saved position
            audioPlayer.seekTo(progress.position_seconds);
            hasRestoredPosition.current = true;
          } else {
            // Duration not ready, wait 100ms and retry
            setTimeout(checkAndSeek, 100);
          }
        };
        checkAndSeek();
      } else {
        hasRestoredPosition.current = true;
      }
    }
    restorePosition();
  }, [user?.uid, contentId, audioPlayer.duration, skipRestore]);

  /**
   * Reset Restore Flag and Save Timer:
   * When content changes, clear flags to allow restoration for new content.
   */
  useEffect(() => {
    hasRestoredPosition.current = false;
    lastSaveTime.current = 0;
  }, [contentId]);

  /**
   * Save Playback Progress:
   * Throttled save (10s minimum interval) + save on pause.
   * Prevents excessive Firestore writes while keeping progress up-to-date.
   *
   * Throttle is implemented by checking time since last save.
   */
  useEffect(() => {
    if (!user?.uid || !contentId || !contentType) return;
    // Don't save if we haven't started yet (position < 5s)
    if (audioPlayer.position < 5 || audioPlayer.duration === 0) return;

    const now = Date.now();
    const shouldSave =
      (!audioPlayer.isPlaying && audioPlayer.position > 5) || // Save on pause
      now - lastSaveTime.current >= 10000; // Or save every 10s

    if (shouldSave) {
      lastSaveTime.current = now;
      savePlaybackProgress(
        user.uid,
        contentId,
        contentType,
        audioPlayer.position,
        audioPlayer.duration
      );
    }
  }, [
    audioPlayer.duration,
    audioPlayer.isPlaying,
    audioPlayer.position,
    contentId,
    contentType,
    user?.uid,
  ]);

  /**
   * Clear Progress on Completion:
   * When content is 95% complete, clear the saved progress.
   * This prevents the player from resuming at the very end.
   */
  useEffect(() => {
    if (!user?.uid || !contentId) return;
    if (audioPlayer.progress >= 0.95 && audioPlayer.duration > 0) {
      clearPlaybackProgress(user.uid, contentId);
    }
  }, [audioPlayer.duration, audioPlayer.progress, contentId, user?.uid]);

  /**
   * Save Position on Unmount:
   * When the player unmounts, save the current position.
   * This ensures we don't lose progress if the user navigates away abruptly.
   */
  useEffect(() => {
    return () => {
      if (
        user?.uid &&
        contentId &&
        contentType &&
        audioPlayer.position > 5 &&
        audioPlayer.duration > 0
      ) {
        savePlaybackProgress(
          user.uid,
          contentId,
          contentType,
          audioPlayer.position,
          audioPlayer.duration
        );
      }
    };
  }, [
    audioPlayer.duration,
    audioPlayer.position,
    contentId,
    contentType,
    user?.uid,
  ]);

  /**
   * Handle Sound Selection:
   * When user selects a background sound, load its audio and start playback.
   * Includes a 200ms delay before autoplay to ensure audio is ready.
   */
  const handleSelectSound = useCallback(
    async (soundId: string | null, selectedAudioPath: string | null) => {
      if (soundId && selectedAudioPath) {
        selectSound(soundId);
        const url = await getAudioUrlFromPath(selectedAudioPath);
        if (url) {
          loadAudio(url, soundId);
          // If main track is playing, resume background audio with delay
          if (audioPlayer.isPlaying) {
            setTimeout(() => {
              playBackgroundAudio();
            }, 200);
          }
        }
      } else {
        // Deselect sound
        selectSound(null);
      }
    },
    [audioPlayer.isPlaying, loadAudio, playBackgroundAudio, selectSound]
  );

  /**
   * Return all state and handlers for the media player.
   * MediaPlayer component uses these to render UI and handle user interactions.
   */
  return {
    // Network status
    isOffline,

    // Sleep timer integration
    sleepTimer,

    // Background audio integration
    backgroundAudio,
    showBackgroundPicker,
    setShowBackgroundPicker,
    currentBackgroundSound,
    handleSelectSound,

    // Content metadata
    narratorPhotoUrl,

    // Player behavior
    autoPlayEnabled,
    toggleAutoPlay,

    // Download state
    isDownloadedState,
    isDownloadingState,
    downloadProgress,
    handleDownload,

    // Modal visibility
    showSleepTimerPicker,
    setShowSleepTimerPicker,
    showReportModal,
    setShowReportModal,
  };
}
