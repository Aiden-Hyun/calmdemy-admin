/**
 * Radio button group with optional audio preview (inline layout).
 *
 * DESIGN PATTERNS:
 * - Radio semantics: Single choice, mutually exclusive
 * - Audio preview: Each option can have sample asset or URL for preview
 * - Inline layout: Unlike Dropdown, options always visible (suitable for small lists)
 *
 * USAGE (e.g., for TTS voice selection):
 * ```tsx
 * <RadioGroup
 *   options={voices}
 *   selectedId={selectedVoiceId}
 *   onSelect={(id) => setSelectedVoiceId(id)}
 * />
 * ```
 *
 * DIFFERENCES FROM DROPDOWN:
 * - RadioGroup is always expanded (no modal)
 * - Better for 3-5 options; Dropdown better for longer lists
 * - Each option has play/pause button visible
 */

import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useAudioPlayer } from '@shared/hooks/useAudioPlayer';
import { Theme } from '@/theme';

export interface RadioOption {
  id: string;
  label: string;
  description?: string;
  sampleUrl?: string;
  sampleAsset?: number;
}

interface RadioGroupProps {
  options: RadioOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * Render radio button group with optional audio preview on each option.
 * Cleanup audio resources on unmount.
 */
export function RadioGroup({ options, selectedId, onSelect }: RadioGroupProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const previewPlayer = useAudioPlayer();

  /**
   * Play/pause/load audio preview for an option.
   * Supports both sampleAsset (local require()) and sampleUrl (remote).
   */
  const handlePreview = async (option: RadioOption) => {
    const source = option.sampleAsset ?? option.sampleUrl;
    if (!source) return;

    if (previewingId && previewingId !== option.id) {
      previewPlayer.stop();
    }

    if (previewingId === option.id) {
      if (previewPlayer.isPlaying) {
        previewPlayer.pause();
      } else {
        previewPlayer.play();
      }
      return;
    }

    try {
      setPreviewingId(option.id);
      setPreviewLoadingId(option.id);
      await previewPlayer.loadAudio(source);
      setPreviewLoadingId(null);
      previewPlayer.play();
    } catch (err) {
      console.warn('Failed to preview audio:', err);
      setPreviewLoadingId(null);
    }
  };

  /** Cleanup audio resources on unmount. */
  useEffect(() => {
    return () => {
      previewPlayer.stop();
      previewPlayer.cleanup();
    };
  }, []);

  return (
    <View style={styles.container}>
      {options.map((option) => {
        const isSelected = option.id === selectedId;
        const isPreviewing = option.id === previewingId;
        const isPreviewLoading = option.id === previewLoadingId;
        return (
          <Pressable
            key={option.id}
            style={({ pressed }) => [
              styles.option,
              isSelected && styles.optionSelected,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => onSelect(option.id)}
          >
            <View style={[styles.radio, isSelected && styles.radioSelected]}>
              {isSelected && <View style={styles.radioDot} />}
            </View>
            <View style={styles.labelContainer}>
              <Text
                style={[styles.label, isSelected && styles.labelSelected]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
              {option.description ? (
                <Text style={styles.description} numberOfLines={1}>
                  {option.description}
                </Text>
              ) : null}
            </View>
            {(option.sampleAsset || option.sampleUrl) ? (
              <Pressable
                style={({ pressed }) => [
                  styles.previewButton,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={(e) => {
                  e.stopPropagation();
                  handlePreview(option);
                }}
              >
                {isPreviewLoading ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Ionicons
                    name={isPreviewing && previewPlayer.isPlaying ? 'pause' : 'play'}
                    size={16}
                    color={theme.colors.primary}
                  />
                )}
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: 6,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.surface,
    },
    optionSelected: {
      backgroundColor: `${theme.colors.primary}12`,
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: theme.colors.gray[300],
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    radioSelected: {
      borderColor: theme.colors.primary,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.colors.primary,
    },
    labelContainer: {
      flex: 1,
    },
    label: {
      fontFamily: 'DMSans-Medium',
      fontSize: 14,
      color: theme.colors.text,
    },
    labelSelected: {
      fontFamily: 'DMSans-SemiBold',
      color: theme.colors.primary,
    },
    description: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
      marginTop: 1,
    },
    previewButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: `${theme.colors.primary}15`,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
  });
