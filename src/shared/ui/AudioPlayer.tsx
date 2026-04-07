/**
 * ============================================================
 * AudioPlayer.tsx — Reusable Audio Player Component
 * (Controlled Component, State Composition, Feature Toggles)
 * ============================================================
 *
 * Architectural Role:
 *   This is a presentation-only audio player UI component. It's fully
 *   controlled by props — no internal audio playback logic. All audio
 *   state (isPlaying, position, duration) and callbacks (onPlay, onPause,
 *   onSeek) are passed down from a parent ViewModel or custom hook that
 *   manages the actual audio engine (e.g., react-native-sound, expo-av).
 *
 *   The component coordinates multiple UI elements: progress slider, play
 *   button, skip buttons, loop toggle, and speed picker modal. It's highly
 *   composable through feature toggles.
 *
 * Design Patterns:
 *   - Controlled Component: All state comes from props; this component is
 *     purely a view layer. The parent controls what plays, when, and at what speed.
 *   - Feature Toggles: showSpeedControl, showLoopControl, showSkipControls
 *     allow callers to customize which controls appear (e.g., basic player
 *     without speed, or full-featured player with all controls).
 *   - Modal Composition: Speed picker is a child modal managed via internal
 *     state (showSpeedPicker). The parent doesn't control this modal; it's
 *     UI state that doesn't affect the audio itself.
 *   - Derived State: tempSpeed is a temporary state used only for the modal
 *     interaction. It's synced with playbackRate when the modal opens, then
 *     confirmed or discarded when the modal closes.
 *
 * Props Structure:
 *   - Playback state: isPlaying, isLoading, duration, position
 *   - Formatted time: formattedPosition, formattedDuration (string MM:SS)
 *   - Callbacks: onPlay, onPause, onSeek, onPlaybackRateChange, etc.
 *   - Optional feature toggles and configuration
 *
 * Consumed By:
 *   Meditation screens, podcast/audio feature screens that need a
 *   standard playback UI without building custom controls.
 *
 * Key Dependencies:
 *   - @react-native-community/slider: drag-to-seek progress bar
 *   - useTheme: styling context
 * ============================================================
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

// --- Constants: Speed control range ---
// These limits define the min/max playback speeds available to users.
// Typical range: 0.5x (half speed, slow) to 2.0x (double speed, fast)
const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;

interface AudioPlayerProps {
  isPlaying: boolean;
  isLoading: boolean;
  duration: number;
  position: number;
  progress: number;
  formattedPosition: string;
  formattedDuration: string;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (position: number) => void;
  title?: string;
  subtitle?: string;
  // Playback controls
  playbackRate?: number;
  isLooping?: boolean;
  onPlaybackRateChange?: (rate: number) => void;
  onSkipBack?: () => void;
  onSkipForward?: () => void;
  onToggleLoop?: () => void;
  // Feature toggles
  showSpeedControl?: boolean;
  showLoopControl?: boolean;
  showSkipControls?: boolean;
}

/**
 * AudioPlayer — Fully Controlled Audio Playback UI
 *
 * This is a presentation component: it renders audio controls and accepts
 * callbacks, but never manages the audio itself. The parent component (a
 * ViewModel or custom hook) drives all playback state.
 *
 * Feature toggles (showSpeedControl, showLoopControl, showSkipControls) allow
 * the parent to customize which controls appear, enabling reuse in different
 * contexts (simple vs. full-featured players).
 *
 * The speed picker modal is the only exception to "controlled" — its visibility
 * is managed internally because it's pure UI state that doesn't affect audio.
 */
export function AudioPlayer({
  isPlaying,
  isLoading,
  duration,
  position,
  formattedPosition,
  formattedDuration,
  onPlay,
  onPause,
  onSeek,
  title,
  subtitle,
  playbackRate = 1.0,
  isLooping = false,
  onPlaybackRateChange,
  onSkipBack,
  onSkipForward,
  onToggleLoop,
  showSpeedControl = true,
  showLoopControl = true,
  showSkipControls = true,
}: AudioPlayerProps) {
  const { theme } = useTheme();
  // Memoize the StyleSheet to avoid recalculation on every render
  const styles = useMemo(() => createStyles(theme), [theme]);

  // --- Speed Picker Modal State ---
  // These two state variables manage the speed picker UI:
  // - showSpeedPicker: controls modal visibility
  // - tempSpeed: temporary state during slider interaction (synced with playbackRate on open)
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);
  const [tempSpeed, setTempSpeed] = useState(playbackRate);

  /**
   * Handler: Updates tempSpeed as user drags the speed slider in the modal.
   * Rounds to nearest 0.1 for clean, readable values (0.5, 0.6, ..., 1.9, 2.0).
   *
   * The rounding prevents floating-point noise from the slider (e.g., 1.2500000001).
   */
  const handleSpeedChange = (value: number) => {
    // Round to nearest 0.1 for clean values
    const rounded = Math.round(value * 10) / 10;
    setTempSpeed(rounded);
  };

  /**
   * Handler: Confirms the speed selection and closes the modal.
   * Calls the parent's onPlaybackRateChange callback with the final tempSpeed value.
   */
  const handleSpeedConfirm = () => {
    onPlaybackRateChange?.(tempSpeed);
    setShowSpeedPicker(false);
  };

  /**
   * Handler: Resets the speed to 1.0x and closes the modal.
   * Calls the parent's onPlaybackRateChange with 1.0.
   */
  const handleResetSpeed = () => {
    setTempSpeed(1.0);
    onPlaybackRateChange?.(1.0);
  };

  /**
   * Handler: Opens the speed picker modal and syncs tempSpeed with the current playbackRate.
   * This ensures the slider starts at the current playback speed, not a stale tempSpeed value.
   *
   * This pattern (sync on open) prevents UI bugs where the slider shows the wrong position
   * if the user opened the modal, closed it without confirming, and then opened it again.
   */
  const handleOpenSpeedPicker = () => {
    setTempSpeed(playbackRate);
    setShowSpeedPicker(true);
  };

  return (
    <View style={styles.container}>
      {/* --- Optional Title/Subtitle Section --- */}
      {(title || subtitle) && (
        <View style={styles.infoContainer}>
          {title && <Text style={styles.title}>{title}</Text>}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      )}

      {/* --- Progress Bar with Time Display --- */}
      <View style={styles.progressContainer}>
        <Text style={styles.timeText}>{formattedPosition}</Text>
        {/* Slider: accepts a numeric position (0 to duration) and calls onSeek on drag end.
            Disabled when loading or duration is 0 (prevents seeking in invalid states). */}
        <Slider
          style={styles.slider}
          value={position}
          minimumValue={0}
          maximumValue={duration}
          onSlidingComplete={onSeek}
          minimumTrackTintColor="white"
          maximumTrackTintColor="rgba(255,255,255,0.3)"
          thumbTintColor="white"
          disabled={isLoading || duration === 0}
        />
        <Text style={styles.timeText}>{formattedDuration}</Text>
      </View>

      {/* --- Large Play/Pause Button --- */}
      <View style={styles.playButtonContainer}>
        <TouchableOpacity
          style={styles.playButton}
          onPress={isPlaying ? onPause : onPlay}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {/* Conditional rendering: show spinner while loading, icon otherwise.
              The icon changes based on isPlaying (play ↔ pause toggle). */}
          {isLoading ? (
            <ActivityIndicator color="white" size="large" />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={44}
              color="white"
              // Visual tweak: offset play icon slightly right for optical balance
              style={isPlaying ? {} : { marginLeft: 6 }}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* --- Secondary Controls Row (Loop, Skip, Speed) --- */}
      <View style={styles.secondaryControls}>
        {/* Feature Toggle: Loop Control */}
        {/* This button is only rendered if showLoopControl=true AND onToggleLoop is provided.
            This is the Feature Toggle pattern — allows callers to customize the UI. */}
        {showLoopControl && onToggleLoop && (
          <TouchableOpacity
            style={styles.controlButton}
            onPress={onToggleLoop}
            disabled={isLoading}
            activeOpacity={0.7}
            accessibilityLabel={isLooping ? 'Loop on' : 'Loop off'}
          >
            <Ionicons
              name="repeat"
              size={22}
              // Color changes based on state: bright white when looping, muted when off
              color={isLooping ? 'white' : 'rgba(255,255,255,0.5)'}
            />
            {/* Active indicator dot: visual feedback that loop is on */}
            {isLooping && <View style={styles.activeIndicator} />}
          </TouchableOpacity>
        )}

        {/* Feature Toggle: Skip Back Button (skip -15 seconds) */}
        {showSkipControls && onSkipBack && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={onSkipBack}
            disabled={isLoading}
            activeOpacity={0.7}
            accessibilityLabel="Rewind 15 seconds"
          >
            <Text style={styles.skipButtonText}>−15s</Text>
          </TouchableOpacity>
        )}

        {/* Feature Toggle: Skip Forward Button (skip +15 seconds) */}
        {showSkipControls && onSkipForward && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={onSkipForward}
            disabled={isLoading}
            activeOpacity={0.7}
            accessibilityLabel="Forward 15 seconds"
          >
            <Text style={styles.skipButtonText}>+15s</Text>
          </TouchableOpacity>
        )}

        {/* Feature Toggle: Speed Control Button */}
        {/* Opens the speed picker modal. The button shows current speed (1x, 1.5x, etc.)
            and highlights when speed is not 1.0x. */}
        {showSpeedControl && onPlaybackRateChange && (
          <TouchableOpacity
            style={styles.speedButton}
            onPress={handleOpenSpeedPicker}
            disabled={isLoading}
            activeOpacity={0.7}
            accessibilityLabel={`Playback speed ${playbackRate}x`}
          >
            {/* Conditional styling: emphasize non-normal speeds */}
            <Text style={[styles.speedText, playbackRate !== 1.0 && styles.speedTextActive]}>
              {playbackRate === 1.0 ? '1x' : `${playbackRate.toFixed(1)}x`}
            </Text>
            {/* Active indicator: shown when speed is not 1.0x */}
            {playbackRate !== 1.0 && <View style={styles.activeIndicator} />}
          </TouchableOpacity>
        )}
      </View>

      {/* --- Speed Picker Modal --- */}
      {/* This modal is managed internally because it's UI state, not audio state.
          Modal Composition pattern: a child modal within the player. */}
      <Modal
        visible={showSpeedPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSpeedPicker(false)}
      >
        {/* Overlay Pressable: tapping outside the picker closes the modal (UX pattern) */}
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowSpeedPicker(false)}
        >
          {/* Inner Pressable: stops propagation so taps on the picker don't close the modal */}
          <Pressable style={styles.speedPickerContainer} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.speedPickerTitle}>Playback Speed</Text>

            {/* Current speed display: large, prominent number showing the temp speed */}
            <View style={styles.speedDisplayContainer}>
              <Text style={styles.speedDisplayValue}>{tempSpeed.toFixed(1)}x</Text>
              {/* "Normal" label appears only when speed is exactly 1.0x */}
              {tempSpeed === 1.0 && (
                <Text style={styles.speedDisplayLabel}>Normal</Text>
              )}
            </View>

            {/* Speed slider: drag to adjust tempSpeed between MIN_SPEED and MAX_SPEED */}
            <View style={styles.speedSliderContainer}>
              <Text style={styles.speedSliderLabel}>{MIN_SPEED}x</Text>
              <Slider
                style={styles.speedSlider}
                value={tempSpeed}
                minimumValue={MIN_SPEED}
                maximumValue={MAX_SPEED}
                step={0.1}
                onValueChange={handleSpeedChange}
                minimumTrackTintColor={theme.colors.primary}
                maximumTrackTintColor={theme.colors.gray[300]}
                thumbTintColor={theme.colors.primary}
              />
              <Text style={styles.speedSliderLabel}>{MAX_SPEED}x</Text>
            </View>

            {/* Action buttons: Reset to 1x or Confirm the selected speed */}
            <View style={styles.speedActions}>
              <TouchableOpacity
                style={styles.speedResetButton}
                onPress={handleResetSpeed}
                activeOpacity={0.7}
              >
                <Text style={styles.speedResetText}>Reset to 1x</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.speedConfirmButton}
                onPress={handleSpeedConfirm}
                activeOpacity={0.8}
              >
                <Text style={styles.speedConfirmText}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      paddingVertical: theme.spacing.md,
    },
    infoContainer: {
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    title: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 20,
      color: 'white',
      textAlign: 'center',
    },
    subtitle: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 16,
      color: 'rgba(255,255,255,0.7)',
      marginTop: theme.spacing.xs,
      textAlign: 'center',
    },
    progressContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
      paddingHorizontal: theme.spacing.sm,
    },
    slider: {
      flex: 1,
      height: 40,
      marginHorizontal: theme.spacing.sm,
    },
    timeText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: 'rgba(255,255,255,0.7)',
      minWidth: 42,
      textAlign: 'center',
    },
    // Large Play Button
    playButtonContainer: {
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    playButton: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.3)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Secondary Controls
    secondaryControls: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing.xl,
    },
    controlButton: {
      width: 48,
      height: 48,
      justifyContent: 'center',
      alignItems: 'center',
    },
    activeIndicator: {
      position: 'absolute',
      bottom: 2,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: 'white',
    },
    // Skip Buttons
    skipButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.borderRadius.full,
      backgroundColor: 'rgba(255,255,255,0.1)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    skipButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: 'rgba(255,255,255,0.9)',
      letterSpacing: 0.5,
    },
    // Speed Button
    speedButton: {
      height: 48,
      paddingHorizontal: theme.spacing.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    speedText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 15,
      color: 'rgba(255,255,255,0.5)',
    },
    speedTextActive: {
      color: 'white',
    },
    // Speed Picker Modal
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    speedPickerContainer: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: theme.spacing.xl,
      width: '85%',
      maxWidth: 340,
      ...theme.shadows.lg,
    },
    speedPickerTitle: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 18,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: theme.spacing.lg,
    },
    speedDisplayContainer: {
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    speedDisplayValue: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 48,
      color: theme.colors.primary,
    },
    speedDisplayLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: theme.colors.textLight,
      marginTop: theme.spacing.xs,
    },
    speedSliderContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    speedSlider: {
      flex: 1,
      height: 40,
      marginHorizontal: theme.spacing.sm,
    },
    speedSliderLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.textLight,
      minWidth: 32,
      textAlign: 'center',
    },
    speedActions: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    speedResetButton: {
      flex: 1,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.gray[100],
      alignItems: 'center',
    },
    speedResetText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.text,
    },
    speedConfirmButton: {
      flex: 1,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
    },
    speedConfirmText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 15,
      color: 'white',
    },
  });
