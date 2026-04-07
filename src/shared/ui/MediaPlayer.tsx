/**
 * MediaPlayer.tsx
 *
 * Architectural Role:
 * Comprehensive audio player component for meditations, courses, and sleep content.
 * Orchestrates audio playback, UI state (favorite, download, ratings, sleep timer, background audio),
 * and navigation (previous/next). This is the primary user-facing playback interface.
 *
 * Design Patterns:
 * - Composition with Headless Logic: useAudioPlayer hook provides audio state, useMediaPlayerController
 *   handles contextual features (background audio, sleep timer). Component assembles sub-components.
 * - Responsive Layout: Scales text sizes, artwork, and spacing based on screen width breakpoints.
 *   Ensures readability on small phones and tablets without layout breaks.
 * - Feature Toggles via Props: showFavorite, showSleepTimer, showReport, etc. allow parents to hide
 *   features for different content types or user segments. Admin/QA testing simplified.
 * - Performance Monitoring (dev): Tracks render time and logs when exceeds PERF_LOG_THRESHOLD_MS.
 *   Helps identify performance regressions early.
 *
 * Key Dependencies:
 * - useAudioPlayer: Playback state, seek, skip, playback rate control
 * - useMediaPlayerController: Feature state (background audio, sleep timer, download)
 * - Sub-components: Modular feature groups (header, content, transport, modals)
 * - LinearGradient: Theme-aware background
 *
 * Consumed By:
 * - Meditation play screens
 * - Course/series playback screens
 * - Sleep music player
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AudioPlayer } from './AudioPlayer';
import { BackgroundAudioPicker } from './BackgroundAudioPicker';
import { SleepTimerPicker } from './SleepTimerPicker';
import { ReportModal } from './ReportModal';
import { RatingType, ReportCategory } from '@/types';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { formatTimerDisplay } from '@core/providers/contexts/SleepTimerContext';
import { useAudioPlayer } from '@shared/hooks/useAudioPlayer';
import { useMediaPlayerController } from './media-player/useMediaPlayerController';
import { createMediaPlayerStyles } from './media-player/styles';
import { MediaPlayerHeader } from './media-player/MediaPlayerHeader';
import { MediaPlayerContentInfo } from './media-player/MediaPlayerContentInfo';
import { MediaPlayerTransportActions } from './media-player/MediaPlayerTransportActions';

export interface MediaPlayerProps {
  // Content info
  category: string;
  title: string;
  instructor?: string;
  instructorPhotoUrl?: string;
  description?: string;
  metaInfo?: string; // e.g., "CBT 101 · Module 1 Practice"
  durationMinutes: number;
  difficultyLevel?: string;

  // Styling
  gradientColors: [string, string];
  artworkIcon: keyof typeof Ionicons.glyphMap;
  artworkThumbnailUrl?: string;

  // State
  isFavorited: boolean;
  isLoading: boolean;

  // Audio player state (from useAudioPlayer)
  audioPlayer: ReturnType<typeof useAudioPlayer>;

  // Callbacks
  onBack: () => void;
  onToggleFavorite: () => void;
  onPlayPause: () => void;

  // Optional loading text
  loadingText?: string;

  // Optional footer content (e.g., sleep timer button)
  footerContent?: React.ReactNode;

  // Enable background audio feature (default: true for meditations)
  enableBackgroundAudio?: boolean;

  // Admin/QA control toggles
  showFavorite?: boolean;
  showSleepTimer?: boolean;
  showReport?: boolean;
  showAutoplay?: boolean;
  showDownload?: boolean;
  showRatings?: boolean;

  // Previous/Next navigation (for collections like courses, series, albums)
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;

  // Content identification for progress tracking
  contentId?: string;
  contentType?: string;

  // Audio URL for download
  audioUrl?: string;
  
  // Additional metadata for downloads
  parentId?: string;
  parentTitle?: string;
  audioPath?: string;

  // Skip restoring saved position (e.g., when autoplay triggers next track)
  skipRestore?: boolean;

  // Rating and report
  userRating?: RatingType | null;
  onRate?: (rating: RatingType) => Promise<RatingType | null>;
  onReport?: (category: ReportCategory, description?: string) => Promise<boolean>;
}

/**
 * Performance monitoring for dev builds. Tracks render time and warns if a single
 * render takes longer than this threshold (in milliseconds). Helps catch performance
 * regressions early, especially important for animation-heavy screens.
 */
const PERF_LOG_THRESHOLD_MS = 8;

/**
 * High-resolution timer for performance measurements. Falls back to Date.now()
 * if globalThis.performance is unavailable (rare edge cases).
 */
const getNow = () => {
  if (typeof globalThis !== 'undefined' && globalThis.performance?.now) {
    return globalThis.performance.now();
  }
  return Date.now();
};

export function MediaPlayer({
  category,
  title,
  instructor,
  instructorPhotoUrl,
  description,
  metaInfo,
  durationMinutes,
  difficultyLevel,
  gradientColors,
  artworkIcon,
  artworkThumbnailUrl,
  isFavorited,
  isLoading,
  audioPlayer,
  onBack,
  onToggleFavorite,
  onPlayPause,
  loadingText = 'Loading...',
  footerContent,
  enableBackgroundAudio = true,
  showFavorite = true,
  showSleepTimer = true,
  showReport = true,
  showAutoplay = true,
  showDownload = true,
  showRatings = true,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  contentId,
  contentType,
  audioUrl,
  parentId,
  parentTitle,
  audioPath,
  skipRestore = false,
  userRating,
  onRate,
  onReport,
}: MediaPlayerProps) {
  /**
   * Performance monitoring refs (dev only). Tracks time from render start to commit.
   * renderStartRef.current is updated on every render to capture the starting timestamp.
   * hasMountedRef tracks whether this is the first mount or a subsequent update.
   */
  const renderStartRef = useRef(0);
  const hasMountedRef = useRef(false);
  renderStartRef.current = getNow();

  /**
   * Dev-only performance check: Logs render duration if it exceeds PERF_LOG_THRESHOLD_MS.
   * Runs after every render (no dependency array) to catch performance issues early.
   * Differentiates between mount (first render) and update (subsequent renders).
   *
   * In production (__DEV__ === false), this effect is skipped entirely.
   */
  useEffect(() => {
    if (!__DEV__) return;

    const durationMs = getNow() - renderStartRef.current;
    const phase = hasMountedRef.current ? 'update' : 'mount';
    hasMountedRef.current = true;

    if (durationMs >= PERF_LOG_THRESHOLD_MS) {
      console.log(`[MediaPlayer] ${phase} render ${durationMs.toFixed(1)}ms`);
    }
  });

  const { theme, isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  /**
   * Responsive breakpoints for different phone sizes. Ensures the UI scales gracefully
   * across small phones (iPhone SE ~375), standard phones (iPhone 12~390), and larger
   * devices (iPhone 14 Pro Max ~428+).
   *
   * Breakpoints:
   * - isSmallScreen (<375): SE and older iPhones
   * - isMediumScreen (375-413): Standard size (iPhone 12, 13)
   * - Large (>=414): Plus/Pro Max and larger Android devices
   */
  // Responsive breakpoints
  const isSmallScreen = screenWidth < 375;
  const isMediumScreen = screenWidth >= 375 && screenWidth < 414;

  /**
   * Responsive sizing values derived from screen width. These propagate to child
   * components to maintain proper proportions and readability across devices.
   *
   * Example: On a small screen (375px), title uses 22px; on large (430px), uses 28px.
   * This keeps the title readable without overflowing layout on small devices.
   */
  // Responsive values
  const artworkSize = isSmallScreen ? 100 : isMediumScreen ? 120 : 140;
  const titleFontSize = isSmallScreen ? 22 : isMediumScreen ? 25 : 28;
  const artworkIconSize = isSmallScreen ? 48 : isMediumScreen ? 56 : 64;
  const contentPadding = isSmallScreen ? 12 : isMediumScreen ? 16 : 24;
  const sectionMargin = isSmallScreen ? 12 : isMediumScreen ? 16 : 24;
  
  const styles = useMemo(() => createMediaPlayerStyles(theme), [theme]);
  const {
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
  } = useMediaPlayerController({
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
  });

  /**
   * Gradient selection logic:
   * - If dark mode is enabled, use a neutral dark gradient instead of content-specific colors.
   *   This provides consistent dark UX across all content types.
   * - If light mode, use the content-specific gradient from props (e.g., purple for focus,
   *   blue for stress reduction).
   *
   * This gives the player flexibility to adapt to system theme while maintaining brand identity.
   */
  // Use dark gradient in dark mode
  const darkGradient: [string, string] = ['#1A1D29', '#2A2D3E'];
  const effectiveGradient = isDark ? darkGradient : gradientColors;

  /**
   * Download availability check: Only show download option if:
   * - Device is online (not in offline mode)
   * - Content ID and type are provided (required for tracking)
   * - Audio URL is available (no point downloading without source)
   *
   * Parent components set these; they're not always present (e.g., live streams).
   */
  const canDownload = !isOffline && !!contentId && !!contentType && !!audioUrl;
  const openSleepTimerPicker = useCallback(() => setShowSleepTimerPicker(true), [
    setShowSleepTimerPicker,
  ]);
  const openBackgroundPicker = useCallback(() => setShowBackgroundPicker(true), [
    setShowBackgroundPicker,
  ]);
  const openReportModal = useCallback(() => setShowReportModal(true), [
    setShowReportModal,
  ]);
  const closeBackgroundPicker = useCallback(
    () => setShowBackgroundPicker(false),
    [setShowBackgroundPicker]
  );
  const closeSleepTimerPicker = useCallback(
    () => setShowSleepTimerPicker(false),
    [setShowSleepTimerPicker]
  );
  const closeReportModal = useCallback(() => setShowReportModal(false), [
    setShowReportModal,
  ]);

  if (isLoading) {
    return (
      <LinearGradient colors={effectiveGradient} style={styles.fullScreen}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="white" />
            <Text style={styles.loadingText}>{loadingText}</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={effectiveGradient}
      style={styles.fullScreen}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView style={styles.safeArea}>
        <MediaPlayerHeader
          styles={styles}
          onBack={onBack}
          onOpenSleepTimer={openSleepTimerPicker}
          onOpenBackgroundPicker={openBackgroundPicker}
          onToggleFavorite={onToggleFavorite}
          onOpenReport={openReportModal}
          enableBackgroundAudio={enableBackgroundAudio}
          isBackgroundAudioActive={
            backgroundAudio.isEnabled && !!backgroundAudio.selectedSoundId
          }
          isSleepTimerActive={sleepTimer.isActive}
          isFavorited={isFavorited}
          showReportButton={showReport && !!onReport}
          showFavorite={showFavorite}
          showSleepTimer={showSleepTimer}
        />

        {/* Background Audio Indicator */}
        {enableBackgroundAudio && backgroundAudio.isEnabled && currentBackgroundSound && audioPlayer.isPlaying && (
          <TouchableOpacity
            style={styles.backgroundIndicator}
            onPress={openBackgroundPicker}
          >
            <Ionicons name="musical-notes" size={14} color="rgba(255,255,255,0.7)" />
            <Text style={styles.backgroundIndicatorText}>
              {currentBackgroundSound.title}
            </Text>
          </TouchableOpacity>
        )}

        {/* Sleep Timer Indicator */}
        {showSleepTimer && sleepTimer.isActive && (
          <TouchableOpacity
            style={styles.sleepTimerIndicator}
            onPress={openSleepTimerPicker}
          >
            <Ionicons name="timer-outline" size={14} color="#7DAFB4" />
            <Text style={styles.sleepTimerIndicatorText}>
              {sleepTimer.isFadingOut ? 'Fading out...' : formatTimerDisplay(sleepTimer.remainingSeconds)}
            </Text>
          </TouchableOpacity>
        )}

        {/* Content - ScrollView for smaller screens */}
        <ScrollView 
          style={[styles.content, { paddingHorizontal: contentPadding }]}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          <MediaPlayerContentInfo
            styles={styles}
            category={category}
            title={title}
            titleFontSize={titleFontSize}
            description={description}
            metaInfo={metaInfo}
            durationMinutes={durationMinutes}
            difficultyLevel={difficultyLevel}
            instructor={instructor}
            narratorPhotoUrl={narratorPhotoUrl}
            artworkThumbnailUrl={artworkThumbnailUrl}
            artworkIcon={artworkIcon}
            artworkSize={artworkSize}
            artworkIconSize={artworkIconSize}
            sectionMargin={sectionMargin}
          />

          {/* Audio Player */}
          <View style={[styles.playerContainer, { marginBottom: sectionMargin }]}>
            {audioPlayer.isLoading && !audioPlayer.duration ? (
              <View style={styles.loadingPlayer}>
                <ActivityIndicator size="large" color="white" />
                <Text style={styles.loadingPlayerText}>Loading audio...</Text>
              </View>
            ) : (
              <AudioPlayer
                isPlaying={audioPlayer.isPlaying}
                isLoading={audioPlayer.isLoading}
                duration={audioPlayer.duration}
                position={audioPlayer.position}
                progress={audioPlayer.progress}
                formattedPosition={audioPlayer.formattedPosition}
                formattedDuration={audioPlayer.formattedDuration}
                onPlay={onPlayPause}
                onPause={onPlayPause}
                onSeek={audioPlayer.seekTo}
                // Playback controls
                playbackRate={audioPlayer.playbackRate}
                isLooping={audioPlayer.isLooping}
                onPlaybackRateChange={audioPlayer.setPlaybackRate}
                onSkipBack={() => audioPlayer.skipBackward(15)}
                onSkipForward={() => audioPlayer.skipForward(15)}
                onToggleLoop={() => audioPlayer.setLoop(!audioPlayer.isLooping)}
              />
            )}

            <MediaPlayerTransportActions
              styles={styles}
              hasPrevious={hasPrevious}
              hasNext={hasNext}
              onPrevious={onPrevious}
              onNext={onNext}
              onRate={onRate}
              userRating={userRating}
              autoPlayEnabled={autoPlayEnabled}
              onToggleAutoPlay={toggleAutoPlay}
              canDownload={canDownload}
              isDownloadedState={isDownloadedState}
              isDownloadingState={isDownloadingState}
              downloadProgress={downloadProgress}
              onDownload={handleDownload}
              showAutoplay={showAutoplay}
              showDownload={showDownload}
              showRatings={showRatings}
            />
          </View>

          {/* Optional Footer Content */}
          {footerContent}
        </ScrollView>

        {/* Background Audio Picker Modal */}
        <BackgroundAudioPicker
          visible={showBackgroundPicker}
          onClose={closeBackgroundPicker}
          selectedSoundId={backgroundAudio.selectedSoundId}
          loadingSoundId={backgroundAudio.loadingSoundId}
          isAudioReady={backgroundAudio.isAudioReady}
          hasError={backgroundAudio.hasError}
          volume={backgroundAudio.volume}
          isEnabled={backgroundAudio.isEnabled}
          onSelectSound={handleSelectSound}
          onVolumeChange={backgroundAudio.setVolume}
          onToggleEnabled={backgroundAudio.setEnabled}
        />

        {/* Sleep Timer Picker Modal */}
        <SleepTimerPicker
          visible={showSleepTimer ? showSleepTimerPicker : false}
          onClose={closeSleepTimerPicker}
        />

        {/* Report Modal */}
        {showReport && onReport && (
          <ReportModal
            visible={showReportModal}
            onClose={closeReportModal}
            onSubmit={onReport}
            contentTitle={title}
          />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}
