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

// Speed range
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
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);

  const [tempSpeed, setTempSpeed] = useState(playbackRate);

  const handleSpeedChange = (value: number) => {
    // Round to nearest 0.1
    const rounded = Math.round(value * 10) / 10;
    setTempSpeed(rounded);
  };

  const handleSpeedConfirm = () => {
    onPlaybackRateChange?.(tempSpeed);
    setShowSpeedPicker(false);
  };

  const handleResetSpeed = () => {
    setTempSpeed(1.0);
    onPlaybackRateChange?.(1.0);
  };

  // Sync temp speed when modal opens
  const handleOpenSpeedPicker = () => {
    setTempSpeed(playbackRate);
    setShowSpeedPicker(true);
  };

  return (
    <View style={styles.container}>
      {(title || subtitle) && (
        <View style={styles.infoContainer}>
          {title && <Text style={styles.title}>{title}</Text>}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      )}

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <Text style={styles.timeText}>{formattedPosition}</Text>
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

      {/* Large Play Button */}
      <View style={styles.playButtonContainer}>
        <TouchableOpacity
          style={styles.playButton}
          onPress={isPlaying ? onPause : onPlay}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="white" size="large" />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={44}
              color="white"
              style={isPlaying ? {} : { marginLeft: 6 }}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Secondary Controls Row */}
      <View style={styles.secondaryControls}>
        {/* Loop Button */}
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
              color={isLooping ? 'white' : 'rgba(255,255,255,0.5)'}
            />
            {isLooping && <View style={styles.activeIndicator} />}
          </TouchableOpacity>
        )}

        {/* Skip Back 15s */}
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

        {/* Skip Forward 15s */}
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

        {/* Speed Button */}
        {showSpeedControl && onPlaybackRateChange && (
          <TouchableOpacity
            style={styles.speedButton}
            onPress={handleOpenSpeedPicker}
            disabled={isLoading}
            activeOpacity={0.7}
            accessibilityLabel={`Playback speed ${playbackRate}x`}
          >
            <Text style={[styles.speedText, playbackRate !== 1.0 && styles.speedTextActive]}>
              {playbackRate === 1.0 ? '1x' : `${playbackRate.toFixed(1)}x`}
            </Text>
            {playbackRate !== 1.0 && <View style={styles.activeIndicator} />}
          </TouchableOpacity>
        )}
      </View>

      {/* Speed Picker Modal */}
      <Modal
        visible={showSpeedPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSpeedPicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowSpeedPicker(false)}
        >
          <Pressable style={styles.speedPickerContainer} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.speedPickerTitle}>Playback Speed</Text>
            
            {/* Current Speed Display */}
            <View style={styles.speedDisplayContainer}>
              <Text style={styles.speedDisplayValue}>{tempSpeed.toFixed(1)}x</Text>
              {tempSpeed === 1.0 && (
                <Text style={styles.speedDisplayLabel}>Normal</Text>
              )}
            </View>

            {/* Slider */}
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

            {/* Actions */}
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
