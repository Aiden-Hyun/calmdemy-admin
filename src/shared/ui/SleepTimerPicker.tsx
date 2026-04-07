/**
 * SleepTimerPicker Component
 *
 * Architectural Role:
 * Modal UI for managing meditation/sleep timers. Provides preset durations
 * and quick extend actions. Integrates with SleepTimerContext for global
 * timer state management.
 *
 * Design Patterns:
 * - Modal Form: Bottom-sheet style selection interface
 * - Dual-state UI: Shows different content based on timer active state
 * - Context Integration: Uses useSleepTimer for global state
 *
 * Key Dependencies:
 * - useSleepTimer: Global timer state management
 * - useTheme: Theme styling (dark theme optimized for nighttime use)
 *
 * Consumed By:
 * - Media player header (sleep timer button)
 * - Quick-access timer in playback controls
 *
 * Design Notes:
 * - Dark background (#1A1D29) is intentional for nighttime usability
 * - Shows different UI based on timer state: selection mode vs. active mode
 * - Extend buttons provide quick +5min and +15min actions
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useSleepTimer, formatTimerDisplay } from '@core/providers/contexts/SleepTimerContext';
import { Theme } from '@/theme';

interface SleepTimerPickerProps {
  visible: boolean;
  onClose: () => void;
}

/** Preset durations for quick selection without custom entry */
const PRESET_DURATIONS = [
  { label: '5 min', minutes: 5 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '60 min', minutes: 60 },
  { label: '90 min', minutes: 90 },
  { label: '2 hours', minutes: 120 },
];

/**
 * SleepTimerPicker - Dual-mode sleep timer UI
 *
 * Two modes:
 * 1. No active timer: Show duration selection screen
 * 2. Active timer: Show remaining time, extend, and cancel options
 */
export function SleepTimerPicker({ visible, onClose }: SleepTimerPickerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { isActive, remainingSeconds, startTimer, cancelTimer, extendTimer } = useSleepTimer();
  const [selectedMinutes, setSelectedMinutes] = useState<number | null>(null);

  /** Update selection state */
  const handleSelectDuration = (minutes: number) => {
    setSelectedMinutes(minutes);
  };

  /** Start timer with selected duration */
  const handleStartTimer = () => {
    if (selectedMinutes) {
      startTimer(selectedMinutes * 60); // Convert minutes to seconds
      setSelectedMinutes(null);
      onClose();
    }
  };

  /** Cancel active timer */
  const handleCancelTimer = () => {
    cancelTimer();
    onClose();
  };

  /** Add time to active timer */
  const handleExtend = (minutes: number) => {
    extendTimer(minutes * 60); // Convert minutes to seconds
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Sleep Timer</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </View>

          {/* Active Timer Display */}
          {isActive && (
            <View style={styles.activeTimerSection}>
              <View style={styles.timerDisplay}>
                <Ionicons name="timer-outline" size={24} color="#7DAFB4" />
                <Text style={styles.timerText}>{formatTimerDisplay(remainingSeconds)}</Text>
              </View>
              <Text style={styles.timerSubtext}>Time remaining</Text>
              
              {/* Extend / Cancel buttons */}
              <View style={styles.activeActions}>
                <TouchableOpacity
                  style={styles.extendButton}
                  onPress={() => handleExtend(5)}
                >
                  <Ionicons name="add" size={18} color="white" />
                  <Text style={styles.extendButtonText}>+5 min</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.extendButton}
                  onPress={() => handleExtend(15)}
                >
                  <Ionicons name="add" size={18} color="white" />
                  <Text style={styles.extendButtonText}>+15 min</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleCancelTimer}
                >
                  <Text style={styles.cancelButtonText}>Cancel Timer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Duration Selection (when no timer active) */}
          {!isActive && (
            <>
              <Text style={styles.sectionLabel}>Select Duration</Text>
              <ScrollView 
                style={styles.durationList}
                contentContainerStyle={styles.durationListContent}
                showsVerticalScrollIndicator={false}
              >
                {PRESET_DURATIONS.map((duration) => (
                  <TouchableOpacity
                    key={duration.minutes}
                    style={[
                      styles.durationItem,
                      selectedMinutes === duration.minutes && styles.durationItemSelected,
                    ]}
                    onPress={() => handleSelectDuration(duration.minutes)}
                  >
                    <Text
                      style={[
                        styles.durationText,
                        selectedMinutes === duration.minutes && styles.durationTextSelected,
                      ]}
                    >
                      {duration.label}
                    </Text>
                    {selectedMinutes === duration.minutes && (
                      <Ionicons name="checkmark-circle" size={22} color="#7DAFB4" />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Start Button */}
              <TouchableOpacity
                style={[
                  styles.startButton,
                  !selectedMinutes && styles.startButtonDisabled,
                ]}
                onPress={handleStartTimer}
                disabled={!selectedMinutes}
              >
                <Ionicons name="timer-outline" size={20} color="white" />
                <Text style={styles.startButtonText}>
                  {selectedMinutes ? `Start ${selectedMinutes} min Timer` : 'Select a Duration'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    container: {
      backgroundColor: '#1A1D29',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 20,
      paddingBottom: 40,
      paddingHorizontal: 20,
      maxHeight: '70%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    title: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 20,
      color: '#fff',
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.1)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    activeTimerSection: {
      alignItems: 'center',
      paddingVertical: 20,
    },
    timerDisplay: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    timerText: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 48,
      color: '#fff',
    },
    timerSubtext: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: 'rgba(255,255,255,0.6)',
      marginTop: 8,
    },
    activeActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 24,
      justifyContent: 'center',
    },
    extendButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 10,
      paddingHorizontal: 16,
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 20,
    },
    extendButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: '#fff',
    },
    cancelButton: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      backgroundColor: 'rgba(231,115,115,0.2)',
      borderRadius: 20,
    },
    cancelButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: '#E57373',
    },
    sectionLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: 'rgba(255,255,255,0.6)',
      marginBottom: 12,
    },
    durationList: {
      maxHeight: 300,
    },
    durationListContent: {
      gap: 8,
      paddingBottom: 16,
    },
    durationItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: 'rgba(255,255,255,0.06)',
      borderRadius: 12,
    },
    durationItemSelected: {
      backgroundColor: 'rgba(125,175,180,0.2)',
      borderWidth: 1,
      borderColor: 'rgba(125,175,180,0.4)',
    },
    durationText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 16,
      color: 'rgba(255,255,255,0.8)',
    },
    durationTextSelected: {
      color: '#fff',
    },
    startButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 16,
      backgroundColor: '#7DAFB4',
      borderRadius: 16,
      marginTop: 16,
    },
    startButtonDisabled: {
      backgroundColor: 'rgba(125,175,180,0.3)',
    },
    startButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: '#fff',
    },
  });
