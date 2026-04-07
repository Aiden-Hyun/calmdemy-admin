/**
 * MediaPlayerTransportActions Component
 *
 * Architectural Role:
 * Presentational sub-component for media player control buttons. Renders
 * two distinct layouts based on whether track navigation is available.
 * Handles playback actions: next/previous, ratings, autoplay, download.
 *
 * Design Patterns:
 * - Layout Branching: Two UI modes based on track navigation availability
 * - Memoized: Wrapped with React.memo to prevent re-renders
 * - Composition: Composed by parent MediaPlayer screen
 * - Feature Gating: Each feature can be hidden via show* flags
 *
 * Key Dependencies:
 * - MediaPlayerStyles: Centralized style definitions
 * - RatingType: User rating model (like, dislike, null)
 *
 * Consumed By:
 * - MediaPlayer (main playback screen)
 *
 * Design Notes:
 * - Track Navigation Mode: Previous/Next buttons + action buttons (like, autoplay, download)
 * - Standalone Mode: Ratings only + optional download (used for single-track content)
 * - Download state machine: idle -> downloading (% shown) -> downloaded
 * - Active state indicated by color (green for like, red for dislike, teal for active)
 */

import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RatingType } from "@/types";
import type { MediaPlayerStyles } from "./styles";

interface MediaPlayerTransportActionsProps {
  /** Pre-computed theme-based styles */
  styles: MediaPlayerStyles;
  /** Whether a previous track is available */
  hasPrevious: boolean;
  /** Whether a next track is available */
  hasNext: boolean;
  /** Callback for previous track */
  onPrevious?: () => void;
  /** Callback for next track */
  onNext?: () => void;
  /** Rate content (like/dislike); returns updated rating */
  onRate?: (rating: RatingType) => Promise<RatingType | null>;
  /** Current user rating (if any) */
  userRating?: RatingType | null;
  /** Whether autoplay is currently enabled */
  autoPlayEnabled: boolean;
  /** Toggle autoplay setting */
  onToggleAutoPlay: () => Promise<void>;
  /** Whether download is possible (premium, online, etc.) */
  canDownload: boolean;
  /** Content is already downloaded */
  isDownloadedState: boolean;
  /** Download is in progress */
  isDownloadingState: boolean;
  /** Download progress 0-100 */
  downloadProgress: number;
  /** Initiate download */
  onDownload: () => Promise<void>;
  /** Show autoplay button */
  showAutoplay?: boolean;
  /** Show download button */
  showDownload?: boolean;
  /** Show like/dislike buttons */
  showRatings?: boolean;
}

/**
 * MediaPlayerTransportActions - Playback control buttons
 *
 * Two rendering modes:
 * 1. With Track Navigation: Track buttons (prev/next) + action buttons
 * 2. Standalone: Ratings + optional download (minimal UI)
 */
function MediaPlayerTransportActionsComponent({
  styles,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onRate,
  userRating,
  autoPlayEnabled,
  onToggleAutoPlay,
  canDownload,
  isDownloadedState,
  isDownloadingState,
  downloadProgress,
  onDownload,
  showAutoplay = true,
  showDownload = true,
  showRatings = true,
}: MediaPlayerTransportActionsProps) {
  /**
   * Layout Mode Detection:
   * If previous/next callbacks are defined, render the full track navigation UI.
   * Otherwise, render minimal standalone UI (ratings + download only).
   */
  const showTrackNavigation = !!(onPrevious || onNext);

  /**
   * Download Button:
   * State machine with three visual states:
   * - Idle: "Download" text with cloud icon
   * - Downloading: Progress percentage with spinner
   * - Downloaded: "Saved" with checkmark (disabled/non-interactive)
   *
   * Only rendered if download is available (showDownload && canDownload).
   */
  const downloadButton = showDownload && canDownload ? (
    <TouchableOpacity
      style={[
        showTrackNavigation ? styles.actionButton : styles.toggleButton,
        isDownloadedState &&
          (showTrackNavigation ? styles.actionButtonActive : styles.toggleButtonActive),
        isDownloadingState &&
          (showTrackNavigation
            ? styles.actionButtonDownloading
            : styles.toggleButtonDownloading),
      ]}
      onPress={onDownload}
      activeOpacity={0.7}
      disabled={isDownloadingState || isDownloadedState}
    >
      {isDownloadingState ? (
        /* Downloading: Show progress percentage */
        <>
          <ActivityIndicator size={14} color="white" />
          <Text style={showTrackNavigation ? styles.actionTextActive : styles.toggleTextActive}>
            {downloadProgress}%
          </Text>
        </>
      ) : (
        /* Idle or Downloaded: Show icon and label */
        <>
          <Ionicons
            name={isDownloadedState ? "checkmark-circle" : "cloud-download-outline"}
            size={18}
            color={isDownloadedState ? "#4CAF50" : "rgba(255,255,255,0.7)"}
          />
          <Text
            style={[
              showTrackNavigation ? styles.actionText : styles.toggleText,
              isDownloadedState &&
                (showTrackNavigation
                  ? styles.actionTextDownloaded
                  : styles.toggleTextDownloaded),
            ]}
          >
            {isDownloadedState ? "Saved" : "Download"}
          </Text>
        </>
      )}
    </TouchableOpacity>
  ) : null;

  if (showTrackNavigation) {
    /**
     * Full Navigation Mode:
     * Shows previous/next track buttons + action buttons.
     * Used for playlists, courses, or series with multiple tracks.
     */
    return (
      <View style={styles.trackNavigationContainer}>
        {/* Track Navigation Buttons */}
        <View style={styles.trackNavigation}>
          {/* Previous Button */}
          <TouchableOpacity
            style={[styles.trackNavButton, !hasPrevious && styles.trackNavButtonDisabled]}
            onPress={hasPrevious ? onPrevious : undefined}
            disabled={!hasPrevious}
            activeOpacity={0.7}
          >
            <Ionicons
              name="play-skip-back"
              size={16}
              color={hasPrevious ? "white" : "rgba(255,255,255,0.3)"}
            />
            <Text style={[styles.trackNavText, !hasPrevious && styles.trackNavTextDisabled]}>
              Previous
            </Text>
          </TouchableOpacity>

          {/* Next Button */}
          <TouchableOpacity
            style={[styles.trackNavButton, !hasNext && styles.trackNavButtonDisabled]}
            onPress={hasNext ? onNext : undefined}
            disabled={!hasNext}
            activeOpacity={0.7}
          >
            <Text style={[styles.trackNavText, !hasNext && styles.trackNavTextDisabled]}>
              Next
            </Text>
            <Ionicons
              name="play-skip-forward"
              size={16}
              color={hasNext ? "white" : "rgba(255,255,255,0.3)"}
            />
          </TouchableOpacity>
        </View>

        {/* Action Buttons: Like, Dislike, Autoplay, Download */}
        <View style={styles.actionControls}>
          {/* Like Button */}
          {showRatings && onRate && (
            <TouchableOpacity
              style={[styles.actionButton, userRating === "like" && styles.actionButtonLiked]}
              onPress={() => onRate("like")}
              activeOpacity={0.7}
            >
              <Ionicons
                name={userRating === "like" ? "thumbs-up" : "thumbs-up-outline"}
                size={18}
                color={userRating === "like" ? "#4CAF50" : "rgba(255,255,255,0.7)"}
              />
            </TouchableOpacity>
          )}

          {/* Dislike Button */}
          {showRatings && onRate && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                userRating === "dislike" && styles.actionButtonDisliked,
              ]}
              onPress={() => onRate("dislike")}
              activeOpacity={0.7}
            >
              <Ionicons
                name={userRating === "dislike" ? "thumbs-down" : "thumbs-down-outline"}
                size={18}
                color={userRating === "dislike" ? "#FF6B6B" : "rgba(255,255,255,0.7)"}
              />
            </TouchableOpacity>
          )}

          {/* Autoplay Toggle */}
          {showAutoplay && (
            <TouchableOpacity
              style={[styles.actionButton, autoPlayEnabled && styles.actionButtonActive]}
              onPress={onToggleAutoPlay}
              activeOpacity={0.7}
            >
              <Ionicons
                name={autoPlayEnabled ? "play-forward-circle" : "play-forward-circle-outline"}
                size={18}
                color={autoPlayEnabled ? "white" : "rgba(255,255,255,0.7)"}
              />
              <Text style={[styles.actionText, autoPlayEnabled && styles.actionTextActive]}>
                Autoplay
              </Text>
            </TouchableOpacity>
          )}

          {/* Download Button */}
          {downloadButton}
        </View>
      </View>
    );
  }

  /**
   * Standalone Mode:
   * Minimal UI with ratings + optional download.
   * Used for single-track content (meditations, sleep stories).
   */
  return (
    <View style={styles.standaloneDownload}>
      {/* Like Button */}
      {showRatings && onRate && (
        <TouchableOpacity
          style={[styles.toggleButton, userRating === "like" && styles.toggleButtonLiked]}
          onPress={() => onRate("like")}
          activeOpacity={0.7}
        >
          <Ionicons
            name={userRating === "like" ? "thumbs-up" : "thumbs-up-outline"}
            size={16}
            color={userRating === "like" ? "#4CAF50" : "rgba(255,255,255,0.7)"}
          />
        </TouchableOpacity>
      )}

      {/* Dislike Button */}
      {showRatings && onRate && (
        <TouchableOpacity
          style={[styles.toggleButton, userRating === "dislike" && styles.toggleButtonDisliked]}
          onPress={() => onRate("dislike")}
          activeOpacity={0.7}
        >
          <Ionicons
            name={userRating === "dislike" ? "thumbs-down" : "thumbs-down-outline"}
            size={16}
            color={userRating === "dislike" ? "#FF6B6B" : "rgba(255,255,255,0.7)"}
          />
        </TouchableOpacity>
      )}

      {/* Download Button */}
      {downloadButton}
    </View>
  );
}

/**
 * Memoization:
 * Prevents re-renders when parent updates unless props actually change.
 */
export const MediaPlayerTransportActions = React.memo(
  MediaPlayerTransportActionsComponent
);
