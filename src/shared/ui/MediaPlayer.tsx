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

const PERF_LOG_THRESHOLD_MS = 8;

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
  const renderStartRef = useRef(0);
  const hasMountedRef = useRef(false);
  renderStartRef.current = getNow();

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
  
  // Responsive breakpoints
  const isSmallScreen = screenWidth < 375;
  const isMediumScreen = screenWidth >= 375 && screenWidth < 414;
  
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

  // Use dark gradient in dark mode
  const darkGradient: [string, string] = ['#1A1D29', '#2A2D3E'];
  const effectiveGradient = isDark ? darkGradient : gradientColors;
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
