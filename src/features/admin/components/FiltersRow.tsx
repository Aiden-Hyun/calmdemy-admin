import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { JobStatus } from '../types';
import { Theme } from '@/theme';

const FILTER_OPTIONS: { label: string; value: JobStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'pending' },
  { label: 'TTS Pending', value: 'tts_pending' },
  { label: 'Active', value: 'llm_generating' },
  { label: 'Paused', value: 'paused' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
];

interface FiltersRowProps {
  selectedFilter: JobStatus | undefined;
  onFilterChange: (next: JobStatus | undefined) => void;
}

export function FiltersRow({ selectedFilter, onFilterChange }: FiltersRowProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.filtersRow}>
      {FILTER_OPTIONS.map((opt) => (
        <Pressable
          key={opt.label}
          style={[
            styles.filterChip,
            selectedFilter === opt.value && styles.filterChipActive,
          ]}
          onPress={() => onFilterChange(opt.value)}
        >
          <Text
            style={[
              styles.filterText,
              selectedFilter === opt.value && styles.filterTextActive,
            ]}
          >
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    filtersRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
    },
    filterChipActive: {
      backgroundColor: theme.colors.primary,
    },
    filterText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    filterTextActive: {
      color: '#fff',
    },
  });
