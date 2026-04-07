/**
 * Background Audio Hook - Ambient Sound Accompaniment
 *
 * ARCHITECTURAL ROLE:
 * Mid-level ViewModel that manages ambient audio playing alongside main meditation/content.
 * Uses useAudioPlayer internally but adds persistence (AsyncStorage), sound selection,
 * and loading state tracking. Operates independently from foreground audio to allow
 * meditation playback + background sound simultaneously.
 *
 * DESIGN PATTERNS:
 * - Composition: Uses useAudioPlayer for playback engine
 * - Persistent State: Saves user preferences (selected sound, volume, enabled) to AsyncStorage
 * - Loading State Machine: Tracks which sound is loading vs ready vs errored
 * - Optimistic Updates: Immediately updates UI before AsyncStorage persistence completes
 *
 * KEY RESPONSIBILITIES:
 * 1. Sound selection and persistence
 * 2. Load state management (tracking which sound is "ready")
 * 3. Timeout detection (8-second load timeout)
 * 4. Volume and enabled state persistence
 * 5. Error handling (load failures, storage errors)
 *
 * STATE COMPLEXITY NOTE:
 * This hook has unusual complexity in load state tracking:
 * - selectedSoundId: User's current sound choice
 * - readySoundId: Which sound is actually loaded and ready (may differ if loading)
 * - loadingSoundId: Which sound is currently loading
 *
 * This tri-state design prevents UI bugs where previous sound shows as "ready"
 * while new sound is still loading. See comments in code for non-obvious logic.
 *
 * CONSUMERS:
 * - Meditation detail screens: Show sound selector
 * - Background audio controls: Volume, on/off toggle
 * - Player behavior: Coordinates main audio + background audio playback
 *
 * DEPENDENCIES:
 * - useAudioPlayer: Playback engine
 * - AsyncStorage: Device-local persistence
 * - expo-audio: Native audio
 */

import { useCallback, useState, useEffect, useRef } from "react";
import {
  useAudioPlayer as useExpoAudioPlayer,
  useAudioPlayerStatus,
  AudioSource,
} from "expo-audio";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * AsyncStorage keys for persisting background audio preferences.
 * Persisted across app sessions so user's choices survive app restart.
 */
const STORAGE_KEYS = {
  SELECTED_SOUND: "bg_audio_selected_sound",  // Which sound user selected
  VOLUME: "bg_audio_volume",                   // Sound volume level (0-1)
  ENABLED: "bg_audio_enabled",                 // Whether background audio is enabled
};

/**
 * Background audio state interface for consuming components.
 * UI should check isAudioReady before showing checkmark next to sound name.
 */
export interface BackgroundAudioState {
  isPlaying: boolean;           // Currently playing (not paused)
  isLoading: boolean;           // Buffering (from expo-audio status)
  selectedSoundId: string | null; // User's current sound choice
  volume: number;               // 0-1 volume level
  isEnabled: boolean;           // User toggled background audio on/off
}

/**
 * useBackgroundAudio Hook
 *
 * Manages ambient audio (white noise, nature sounds, music) playing alongside main content.
 * Persists user preferences and tracks loading state with 8-second timeout detection.
 *
 * @returns Object with sound selection, volume control, playback state, and persistence
 *
 * COMPLEX STATE MANAGEMENT:
 * This hook manages three related but distinct sound IDs to prevent UI bugs:
 * - selectedSoundId: User just tapped this sound choice
 * - readySoundId: This sound successfully loaded (checkmark should show)
 * - loadingSoundId: This sound is currently downloading (show spinner)
 *
 * Rationale: User might select Sound A, it's loading, then select Sound B.
 * If we just show selectedSoundId, we'd show checkmark next to Sound A (wrong!).
 * By tracking readySoundId separately, UI shows checkmark only for loaded sound.
 */
export function useBackgroundAudio() {
  /**
   * SOUND SELECTION STATE
   * selectedSoundId: Which sound user last selected (may still be loading)
   * readySoundId: Which sound is fully loaded and ready to play
   * loadingSoundId: Which sound is currently downloading
   *
   * STATE MACHINE:
   * 1. User selects sound A: selectedSoundId = A, loadingSoundId = A, readySoundId = null
   * 2. Sound A loads: readySoundId = A, loadingSoundId = null
   * 3. User selects sound B: selectedSoundId = B, loadingSoundId = B, readySoundId = A (previous)
   * 4. Sound B loads: readySoundId = B, loadingSoundId = null, selectedSoundId = B
   */
  const [selectedSoundId, setSelectedSoundId] = useState<string | null>(null);
  const [loadingSoundId, setLoadingSoundId] = useState<string | null>(null);
  const [readySoundId, setReadySoundId] = useState<string | null>(null); // Track which sound is actually ready

  // Volume and enabled state (persisted)
  const [volume, setVolumeState] = useState(0.3); // Default 30% volume - ambient shouldn't be loud
  const [isEnabled, setIsEnabled] = useState(true);

  // URL tracking
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);

  // Initialization and error state
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [loadStartTime, setLoadStartTime] = useState<number | null>(null);

  /**
   * AUDIO PLAYER INSTANCE
   * Create ambient sound player with null initial source.
   * Source will be loaded via selectSound() -> loadAudio() later.
   */
  const player = useExpoAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  /**
   * MOUNT EFFECT: Load persisted preferences from device storage
   * Runs once on mount to restore user's saved sound choice and volume.
   *
   * ASYNC PATTERN:
   * Uses Promise.all to load all three preferences in parallel (faster).
   * Falls back to defaults if preferences don't exist or storage fails.
   * Sets isInitialized=true whether success or failure (prevents loading states).
   *
   * CONSUMER NOTE:
   * Components should check isInitialized before rendering audio controls.
   * Prevents flickering when preferences are being loaded.
   *
   * DEPENDENCY: [] (mount only)
   */
  useEffect(() => {
    async function loadPreferences() {
      try {
        // Load all three preferences in parallel
        const [savedSoundId, savedVolume, savedEnabled] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.SELECTED_SOUND),
          AsyncStorage.getItem(STORAGE_KEYS.VOLUME),
          AsyncStorage.getItem(STORAGE_KEYS.ENABLED),
        ]);

        // Apply saved preferences (or keep defaults if not found)
        if (savedSoundId) {
          setSelectedSoundId(savedSoundId);
        }
        if (savedVolume) {
          setVolumeState(parseFloat(savedVolume));
        }
        if (savedEnabled !== null) {
          setIsEnabled(savedEnabled === "true");
        }
        setIsInitialized(true); // Preferences loaded (or defaults applied)
      } catch (err) {
        console.warn("Failed to load background audio preferences:", err);
        setIsInitialized(true); // Error - proceed with defaults
      }
    }
    loadPreferences();
  }, []);

  /**
   * AUDIO LOADING EFFECT (useEffect)
   * When sound URL is available and background audio is enabled, load it.
   *
   * BEHAVIOR:
   * - Loads URL into player.replace()
   * - Sets player.loop=true (ambient sounds loop all day/night)
   * - Applies current volume setting
   *
   * WHEN TRIGGERED:
   * - URL changes (user selected new sound)
   * - isEnabled changes (user toggled on/off)
   *
   * NOTE:
   * This effect does NOT auto-play. Sound plays when user taps play button
   * or when meditation starts and auto-starts background audio.
   *
   * DEPENDENCY: [currentAudioUrl, isEnabled]
   */
  useEffect(() => {
    if (currentAudioUrl && isEnabled) {
      try {
        const source: AudioSource = { uri: currentAudioUrl };
        player.replace(source);      // Load new sound
        player.loop = true;          // Ambient = looping
        player.volume = volume;      // Apply saved volume
      } catch (err) {
        console.warn("Failed to load background audio:", err);
      }
    }
  }, [currentAudioUrl, isEnabled]);

  /**
   * VOLUME SYNC EFFECT (useEffect)
   * Whenever volume state changes, push it to player.
   * Separate from load effect because user might adjust volume without changing sound.
   *
   * DEPENDENCY: [volume, player]
   * Includes player because if player instance changes, need to resync volume.
   */
  useEffect(() => {
    try {
      player.volume = volume; // Apply volume to current player
    } catch (err) {
      // Ignore volume sync errors - not critical
    }
  }, [volume, player]);

  /**
   * LOADING URL TRACKING REF
   * Stores the URL we're currently loading to detect when audio actually loads.
   * Used by load-complete detection effect to ensure we don't mark stale loads as complete.
   * Example: User selects URL A (loadingUrlRef=A), then quickly selects URL B.
   * When A completes loading later, we ignore it because loadingUrlRef != A.
   */
  const loadingUrlRef = useRef<string | null>(null);

  /**
   * LOAD AUDIO ACTION (useCallback)
   * Start loading new audio by URL. Called by selectSound() after fetching URL.
   *
   * SIDE EFFECTS:
   * 1. Pause current audio immediately (stop previous sound)
   * 2. Reset error state (new load attempt)
   * 3. Set readySoundId=null (new sound isn't ready yet)
   * 4. Set loadingSoundId (tracking which sound is loading)
   * 5. Start 8-second timeout timer (for timeout detection)
   * 6. Update currentAudioUrl (triggers AUDIO LOADING EFFECT above)
   *
   * STATE MACHINE TRANSITION:
   * BEFORE: readySoundId=soundA (playing), selectedSoundId=soundA, loadingSoundId=null
   * CALL: loadAudio(urlB, soundB)
   * AFTER: readySoundId=soundA (still playing), selectedSoundId=soundA, loadingSoundId=soundB
   *        (until B loads, then: readySoundId=soundB, loadingSoundId=null)
   *
   * DEPENDENCY: [player]
   */
  const loadAudio = useCallback(
    (url: string, soundId: string) => {
      // Stop current audio immediately (clean transition)
      try {
        player.pause();
      } catch (err) {
        // Ignore pause errors - new sound will override anyway
      }

      // Reset state for new load
      setHasError(false);                    // Clear any previous error
      setReadySoundId(null);                 // New sound not ready yet
      setLoadingSoundId(soundId);            // Track that this sound is loading
      setLoadStartTime(Date.now());          // Start timeout counter
      loadingUrlRef.current = url;           // Remember URL for load-complete detection
      setCurrentAudioUrl(url);               // Trigger AUDIO LOADING EFFECT
    },
    [player]
  );
  
  /**
   * LOAD COMPLETE DETECTION (useEffect)
   * Detects when currently-loading sound has finished loading.
   *
   * CONDITION CHECKS:
   * 1. loadingSoundId !== null - We're currently loading a sound
   * 2. status.isLoaded - expo-audio says file is loaded
   * 3. !status.isBuffering - Not buffering (fully ready to play)
   * 4. currentAudioUrl === loadingUrlRef.current - URL matches (prevents stale load detection)
   *
   * 100ms DELAY:
   * Small setTimeout ensures audio is truly stable (not micro-buffering).
   * Without this, isLoaded might briefly become true before buffering resumes.
   *
   * STATE TRANSITION:
   * BEFORE: loadingSoundId=soundB, readySoundId=soundA
   * TRIGGER: status.isLoaded becomes true
   * AFTER: loadingSoundId=null, readySoundId=soundB (new sound ready!)
   *
   * CLEANUP FUNCTION:
   * Returns clearTimeout cleanup to cancel pending state update if dependencies change.
   * Example: User taps new sound before previous one finishes loading.
   *
   * DEPENDENCY: [status.isLoaded, status.isBuffering, loadingSoundId, currentAudioUrl]
   */
  useEffect(() => {
    if (loadingSoundId && status.isLoaded && !status.isBuffering && currentAudioUrl === loadingUrlRef.current) {
      // Small delay to ensure audio is truly ready (not micro-buffering)
      const timer = setTimeout(() => {
        const soundIdToReady = loadingSoundId;
        setLoadingSoundId(null);
        setReadySoundId(soundIdToReady); // Mark THIS specific sound as ready to play
        loadingUrlRef.current = null;
        setLoadStartTime(null);
      }, 100);
      return () => clearTimeout(timer); // Cleanup: cancel if dependencies change
    }
  }, [status.isLoaded, status.isBuffering, loadingSoundId, currentAudioUrl]);

  /**
   * READY SOUND ID REF SYNC (useEffect)
   * Sync readySoundId into a ref so timeout effect can read current value.
   *
   * WHY REF?
   * Timeout callback captures dependencies at creation time. If we only used
   * readySoundId in dependency array, old value would be captured. Ref allows
   * timeout to read current readySoundId even if dependencies are stale.
   *
   * EXAMPLE:
   * 1. Load sound A (8-second timer starts with readySoundId=null)
   * 2. User selects sound B (readySoundIdRef updates to null)
   * 3. After 8 seconds, timeout callback reads readySoundIdRef.current (null)
   *    and knows A still hasn't loaded - marks error
   * Without ref, timeout would have stale captured readySoundId=null but might
   * have become true inside the closure.
   *
   * DEPENDENCY: [readySoundId]
   */
  const readySoundIdRef = useRef<string | null>(null);
  useEffect(() => {
    readySoundIdRef.current = readySoundId; // Keep ref in sync
  }, [readySoundId]);

  /**
   * LOAD TIMEOUT DETECTION (useEffect)
   * If audio hasn't loaded after 8 seconds, assume network error or dead link.
   * Mark as error and stop showing loading state (prevent infinite spinners).
   *
   * TRIGGER CONDITIONS:
   * 1. selectedSoundId exists (user selected a sound)
   * 2. readySoundId !== selectedSoundId (selected sound not ready yet)
   * 3. !hasError (not already in error state)
   * 4. currentAudioUrl exists (we're loading something)
   *
   * TIMEOUT = 8 SECONDS:
   * Typical network timeout. Longer than most fast loads, short enough that user
   * notices (not 30-second timeout). Adjustable if needed.
   *
   * CHECKING AGAINST REF:
   * setTimeout closure reads readySoundIdRef.current (current value, not stale).
   * If still doesn't match targetSoundId after 8 seconds, load failed.
   * This handles case where another sound loaded in the meantime.
   *
   * STATE TRANSITION:
   * BEFORE: loadingSoundId=soundA (showing spinner), readySoundId=null
   * TRIGGER: 8-second timer expires
   * AFTER: hasError=true, loadingSoundId=null (hide spinner, show error)
   *
   * DEPENDENCY: [selectedSoundId, readySoundId, hasError, currentAudioUrl]
   */
  useEffect(() => {
    // Timeout applies when sound is selected but not ready
    if (selectedSoundId && !readySoundId && !hasError && currentAudioUrl) {
      const targetSoundId = selectedSoundId;
      const timer = setTimeout(() => {
        // Read current readySoundId from ref (not closure capture)
        // If still doesn't match target sound, it failed to load
        if (readySoundIdRef.current !== targetSoundId) {
          setHasError(true);            // Mark as load error
          setLoadingSoundId(null);      // Hide loading spinner
          setLoadStartTime(null);       // Clear load start time
        }
      }, 8000); // 8-second timeout
      return () => clearTimeout(timer); // Cleanup if dependencies change
    }
  }, [selectedSoundId, readySoundId, hasError, currentAudioUrl]);

  /**
   * SELECT SOUND ACTION (useCallback)
   * User selected a different ambient sound. Update state and persist choice.
   *
   * NOTE: This selects the sound but doesn't load the audio URL yet.
   * The actual sound repository fetch (URL lookup) is done by consumer.
   * Consumer pattern: selectSound(soundId) -> fetch sound URL -> loadAudio(url, soundId)
   *
   * BEHAVIOR:
   * 1. Pause current audio immediately (no overlap between sounds)
   * 2. Update selectedSoundId (UI shows as selected)
   * 3. If deselecting (soundId=null), clear URL and loading state
   * 4. Persist choice to AsyncStorage (survives app restart)
   *
   * OPTIMISTIC UPDATES:
   * State updated immediately, AsyncStorage persistence happens async.
   * If persistence fails, user still sees selected state (good UX).
   *
   * DEPENDENCY: [player]
   *
   * CONSUMER PATTERN (in component using this hook):
   *   const onSelectSound = async (soundId) => {
   *     selectSound(soundId); // Update selection state
   *     const soundUrl = await fetchSoundUrl(soundId); // Get audio URL
   *     loadAudio(soundUrl, soundId); // Start loading
   *   }
   */
  const selectSound = useCallback(
    async (soundId: string | null) => {
      // Stop current audio immediately
      try {
        player.pause();
      } catch (err) {
        // Ignore pause errors
      }

      setSelectedSoundId(soundId);

      // If deselecting (null), clear loading and URL
      if (!soundId) {
        setCurrentAudioUrl(null);
        setLoadingSoundId(null);
      }

      // Persist to AsyncStorage (async, fire-and-forget)
      try {
        if (soundId) {
          await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_SOUND, soundId);
        } else {
          await AsyncStorage.removeItem(STORAGE_KEYS.SELECTED_SOUND);
        }
      } catch (err) {
        console.warn("Failed to save sound preference:", err);
        // Continue - optimistic update already done
      }
    },
    [player]
  );

  /**
   * SET VOLUME ACTION (useCallback)
   * User adjusted volume slider. Update player and persist preference.
   *
   * CLAMPING:
   * Math.max(0, Math.min(1, newVolume)) ensures 0 <= volume <= 1
   * Prevents invalid values like -0.5 or 1.5 from breaking player.
   *
   * OPTIMISTIC UPDATES:
   * Volume state updated immediately, AsyncStorage persistence is async.
   * User feels responsive UI even if persistence takes 100ms.
   *
   * DEPENDENCY: [player]
   */
  const setVolume = useCallback(
    async (newVolume: number) => {
      const clampedVolume = Math.max(0, Math.min(1, newVolume)); // Clamp to [0, 1]
      setVolumeState(clampedVolume);
      try {
        player.volume = clampedVolume; // Apply immediately
        await AsyncStorage.setItem(STORAGE_KEYS.VOLUME, clampedVolume.toString());
      } catch (err) {
        console.warn("Failed to save volume preference:", err);
        // Continue - optimistic update already applied
      }
    },
    [player]
  );

  /**
   * SET ENABLED ACTION (useCallback)
   * User toggled "Enable Background Audio" switch.
   *
   * BEHAVIOR:
   * 1. Update enabled state (UI reflects toggle)
   * 2. Persist to AsyncStorage
   * 3. If disabling, pause audio immediately
   * 4. If enabling, audio will load next time loadAudio() is called
   *
   * PATTERN:
   * When disabled, background audio is paused. User can toggle on later.
   * When enabled, if a sound is selected, it resumes playing.
   *
   * DEPENDENCY: [player]
   */
  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setIsEnabled(enabled);
      try {
        await AsyncStorage.setItem(STORAGE_KEYS.ENABLED, enabled.toString());
        // If disabling, pause immediately
        if (!enabled) {
          player.pause();
        }
      } catch (err) {
        console.warn("Failed to save enabled preference:", err);
        // Continue - state update already applied
      }
    },
    [player]
  );

  /**
   * PLAY ACTION (useCallback)
   * Start background audio playback.
   *
   * GUARDS:
   * - !isEnabled: Background audio is toggled off, no-op
   * - !currentAudioUrl: No sound loaded yet, no-op
   *
   * SETUP:
   * - player.loop = true: Ambient sounds loop all night
   * - player.volume = volume: Apply saved volume
   * - player.play(): Start playback
   *
   * DEPENDENCY: [player, isEnabled, currentAudioUrl, volume]
   */
  const play = useCallback(() => {
    if (!isEnabled || !currentAudioUrl) return; // Guard: disabled or no audio
    try {
      player.loop = true;    // Ambient sounds loop continuously
      player.volume = volume; // Apply saved volume level
      player.play();         // Start playback
    } catch (err) {
      console.warn("Failed to play background audio:", err);
    }
  }, [player, isEnabled, currentAudioUrl, volume]);

  /**
   * PAUSE ACTION (useCallback)
   * Pause background audio at current position.
   *
   * DEPENDENCY: [player]
   */
  const pause = useCallback(() => {
    try {
      player.pause();
    } catch (err) {
      console.warn("Failed to pause background audio:", err);
    }
  }, [player]);

  /**
   * STOP ACTION (useCallback)
   * Pause and reset to beginning.
   *
   * DEPENDENCY: [player]
   */
  const stop = useCallback(() => {
    try {
      player.pause();      // Pause playback
      player.seekTo(0);    // Reset to start
    } catch (err) {
      console.warn("Failed to stop background audio:", err);
    }
  }, [player]);

  /**
   * CLEANUP ACTION (useCallback)
   * Called on component unmount to stop background audio.
   * Prevents audio continuing after user navigates away.
   *
   * DEPENDENCY: [player]
   */
  const cleanup = useCallback(() => {
    try {
      player.pause();
    } catch (err) {
      // Ignore cleanup errors - best effort only
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
