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

const AUTOPLAY_KEY = "calmdemy_autoplay_enabled";

interface UseMediaPlayerControllerProps {
  audioPlayer: ReturnType<typeof useAudioPlayer>;
  title: string;
  durationMinutes: number;
  artworkThumbnailUrl?: string;
  instructor?: string;
  instructorPhotoUrl?: string;
  enableBackgroundAudio: boolean;
  hasNext: boolean;
  onNext?: () => void;
  contentId?: string;
  contentType?: string;
  audioUrl?: string;
  parentId?: string;
  parentTitle?: string;
  audioPath?: string;
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

  const [showBackgroundPicker, setShowBackgroundPicker] = useState(false);
  const [currentBackgroundSound, setCurrentBackgroundSound] =
    useState<FirestoreSleepSound | null>(null);
  const [narratorPhotoUrl, setNarratorPhotoUrl] = useState<string | null>(
    instructorPhotoUrl || null
  );
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [isDownloadedState, setIsDownloadedState] = useState(false);
  const [isDownloadingState, setIsDownloadingState] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showSleepTimerPicker, setShowSleepTimerPicker] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  const hasTriggeredAutoPlay = useRef(false);
  const lastSaveTime = useRef(0);
  const hasRestoredPosition = useRef(false);
  const onNextRef = useRef(onNext);
  const audioPlayerRef = useRef(audioPlayer);
  const sleepTimerRef = useRef(sleepTimer);
  const autoPlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);

  useEffect(() => {
    audioPlayerRef.current = audioPlayer;
  }, [audioPlayer]);

  useEffect(() => {
    sleepTimerRef.current = sleepTimer;
  }, [sleepTimer]);

  // Load auto-play preference from AsyncStorage
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

  // Check download status on mount and when contentId changes
  useEffect(() => {
    async function checkDownloadStatus() {
      if (!contentId) return;
      const downloaded = await isDownloaded(contentId);
      setIsDownloadedState(downloaded);
      setIsDownloadingState(checkIsDownloading(contentId));
    }
    checkDownloadStatus();
  }, [contentId]);

  const handleDownload = useCallback(async () => {
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

  const toggleAutoPlay = useCallback(async () => {
    let nextValue = false;
    setAutoPlayEnabled((current) => {
      nextValue = !current;
      return nextValue;
    });
    try {
      await AsyncStorage.setItem(AUTOPLAY_KEY, String(nextValue));
    } catch (error) {
      console.error("Failed to save auto-play preference:", error);
    }
  }, []);

  // Fetch narrator photo if not provided
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

  // Fetch current background sound when selectedSoundId changes
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

  // Load saved background sound audio URL when initialized
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

  // Auto-play background audio when it's loaded and enabled
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

  // Cleanup background audio on unmount
  useEffect(() => {
    return () => {
      cleanupBackgroundAudio();
    };
  }, [cleanupBackgroundAudio]);

  // Register audio player with sleep timer for fade-out effect
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

  // Reset auto-play trigger flag when track changes
  useEffect(() => {
    hasTriggeredAutoPlay.current = false;
  }, [title]);

  // Auto-play next track when current one completes
  useEffect(() => {
    if (
      autoPlayEnabled &&
      hasNext &&
      onNextRef.current &&
      audioPlayer.progress >= 0.99 &&
      !audioPlayer.isPlaying &&
      audioPlayer.duration > 0 &&
      !hasTriggeredAutoPlay.current
    ) {
      hasTriggeredAutoPlay.current = true;
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

  // Restore playback position on mount (skip if coming from autoplay)
  useEffect(() => {
    async function restorePosition() {
      if (!user?.uid || !contentId || hasRestoredPosition.current) return;

      if (skipRestore) {
        hasRestoredPosition.current = true;
        return;
      }

      const progress = await getPlaybackProgress(user.uid, contentId);
      if (progress && progress.position_seconds > 5) {
        const checkAndSeek = () => {
          if (audioPlayer.duration > 0) {
            audioPlayer.seekTo(progress.position_seconds);
            hasRestoredPosition.current = true;
          } else {
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

  // Reset restore flag when content changes
  useEffect(() => {
    hasRestoredPosition.current = false;
    lastSaveTime.current = 0;
  }, [contentId]);

  // Save playback position periodically and on pause
  useEffect(() => {
    if (!user?.uid || !contentId || !contentType) return;
    if (audioPlayer.position < 5 || audioPlayer.duration === 0) return;

    const now = Date.now();
    const shouldSave =
      (!audioPlayer.isPlaying && audioPlayer.position > 5) ||
      now - lastSaveTime.current >= 10000;

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

  // Clear progress when content is completed
  useEffect(() => {
    if (!user?.uid || !contentId) return;
    if (audioPlayer.progress >= 0.95 && audioPlayer.duration > 0) {
      clearPlaybackProgress(user.uid, contentId);
    }
  }, [audioPlayer.duration, audioPlayer.progress, contentId, user?.uid]);

  // Save position on unmount
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

  const handleSelectSound = useCallback(
    async (soundId: string | null, selectedAudioPath: string | null) => {
      if (soundId && selectedAudioPath) {
        selectSound(soundId);
        const url = await getAudioUrlFromPath(selectedAudioPath);
        if (url) {
          loadAudio(url, soundId);
          if (audioPlayer.isPlaying) {
            setTimeout(() => {
              playBackgroundAudio();
            }, 200);
          }
        }
      } else {
        selectSound(null);
      }
    },
    [audioPlayer.isPlaying, loadAudio, playBackgroundAudio, selectSound]
  );

  return {
    isOffline,
    sleepTimer,
    backgroundAudio,
    showBackgroundPicker,
    setShowBackgroundPicker,
    currentBackgroundSound,
    narratorPhotoUrl,
    autoPlayEnabled,
    isDownloadedState,
    isDownloadingState,
    downloadProgress,
    showSleepTimerPicker,
    setShowSleepTimerPicker,
    showReportModal,
    setShowReportModal,
    handleDownload,
    toggleAutoPlay,
    handleSelectSound,
  };
}
