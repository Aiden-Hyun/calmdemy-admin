/**
 * MediaPlayerHeader Component
 *
 * Architectural Role:
 * Presentational sub-component for the media player's top control bar.
 * Renders back button, favorite toggle, sleep timer, background audio picker,
 * and report button. All button visibility is controlled via props.
 *
 * Design Patterns:
 * - Leaf Component: Pure presentation, no business logic
 * - Memoized: Wrapped with React.memo to prevent re-renders
 * - Composition: Composed by parent MediaPlayer screen
 * - Conditional Rendering: Each button's visibility is a separate flag
 *
 * Key Dependencies:
 * - MediaPlayerStyles: Centralized style definitions
 * - Ionicons: Icon library for all buttons
 *
 * Consumed By:
 * - MediaPlayer (main playback screen)
 *
 * Design Notes:
 * - Active state indicated by color change (e.g., #7DAFB4 for active)
 * - All callbacks passed from parent (MediaPlayer orchestrates logic)
 * - Back button is always shown (not optional)
 * - Other buttons can be hidden via flags (feature gating)
 */

import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MediaPlayerStyles } from "./styles";

interface MediaPlayerHeaderProps {
  /** Pre-computed theme-based styles */
  styles: MediaPlayerStyles;
  /** Navigation: go back to previous screen */
  onBack: () => void;
  /** Open sleep timer picker modal */
  onOpenSleepTimer: () => void;
  /** Open background audio selection modal */
  onOpenBackgroundPicker: () => void;
  /** Toggle favorite status */
  onToggleFavorite: () => void;
  /** Open content issue report modal */
  onOpenReport: () => void;
  /** Whether background audio feature is available/enabled */
  enableBackgroundAudio: boolean;
  /** Whether background audio is currently playing */
  isBackgroundAudioActive: boolean;
  /** Whether sleep timer is currently running */
  isSleepTimerActive: boolean;
  /** Whether user has favorited this content */
  isFavorited: boolean;
  /** Whether to show the report button */
  showReportButton: boolean;
  /** Whether to show the favorite button */
  showFavorite: boolean;
  /** Whether to show the sleep timer button */
  showSleepTimer: boolean;
}

/**
 * MediaPlayerHeader - Top control bar for media player
 *
 * Renders a horizontal button bar with:
 * - Back button (always visible)
 * - Sleep timer toggle (if enabled)
 * - Background audio toggle (if enabled)
 * - Favorite toggle (if enabled)
 * - Report button (if enabled)
 */
function MediaPlayerHeaderComponent({
  styles,
  onBack,
  onOpenSleepTimer,
  onOpenBackgroundPicker,
  onToggleFavorite,
  onOpenReport,
  enableBackgroundAudio,
  isBackgroundAudioActive,
  isSleepTimerActive,
  isFavorited,
  showReportButton,
  showFavorite,
  showSleepTimer,
}: MediaPlayerHeaderProps) {
  return (
    <View style={styles.header}>
      {/* Back button - always present */}
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="white" />
      </TouchableOpacity>

      {/* Right-side button group */}
      <View style={styles.headerRight}>
        {/* Sleep Timer - conditional on feature flag and prop */}
        {showSleepTimer && (
          <TouchableOpacity
            onPress={onOpenSleepTimer}
            style={[styles.headerButton, isSleepTimerActive && styles.headerButtonActive]}
          >
            <Ionicons
              name="timer-outline"
              size={20}
              color={isSleepTimerActive ? "#7DAFB4" : "white"}
            />
          </TouchableOpacity>
        )}

        {/* Background Audio - conditional on feature availability */}
        {enableBackgroundAudio && (
          <TouchableOpacity
            onPress={onOpenBackgroundPicker}
            style={[styles.headerButton, isBackgroundAudioActive && styles.headerButtonActive]}
          >
            <Ionicons
              name="musical-notes"
              size={20}
              color={isBackgroundAudioActive ? "#7DAFB4" : "white"}
            />
          </TouchableOpacity>
        )}

        {/* Favorite Toggle - conditional on feature flag */}
        {showFavorite && (
          <TouchableOpacity onPress={onToggleFavorite} style={styles.favoriteButton}>
            <Ionicons
              name={isFavorited ? "heart" : "heart-outline"}
              size={24}
              color={isFavorited ? "#FF6B6B" : "white"}
            />
          </TouchableOpacity>
        )}

        {/* Report Button - conditional on feature flag */}
        {showReportButton && (
          <TouchableOpacity onPress={onOpenReport} style={styles.headerButton}>
            <Ionicons name="flag-outline" size={20} color="white" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/**
 * Memoization:
 * Prevents re-renders when parent updates unless props actually change.
 */
export const MediaPlayerHeader = React.memo(MediaPlayerHeaderComponent);
