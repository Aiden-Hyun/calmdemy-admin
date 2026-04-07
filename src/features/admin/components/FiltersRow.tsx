/**
 * Job list filter chip bar with status options.
 *
 * ARCHITECTURAL ROLE:
 * Quick filter navigation for job list. Shows predefined status filters
 * (All, Pending, Active, Completed, etc.) as horizontal chip buttons.
 *
 * DESIGN PATTERN:
 * - Filter bank: Horizontal scrollable row of single-selection chips
 * - Mutually exclusive: Only one filter active at a time
 * - Visual feedback: Active chip highlighted (primary color background)
 * - Default: "All" shows all jobs (filter = undefined)
 *
 * FILTERS:
 * - All (undefined): Show all jobs
 * - Pending: Jobs not yet started
 * - TTS Pending: Waiting for audio conversion
 * - Active: Currently processing (llm_generating)
 * - Paused: User-paused or blocked
 * - Completed: Finished (may need publishing)
 * - Failed: Terminal error state
 *
 * USAGE EXAMPLE:
 * ```tsx
 * const [filter, setFilter] = useState<JobStatus | undefined>();
 * <FiltersRow selectedFilter={filter} onFilterChange={setFilter} />
 * ```
 */

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

/**
 * Render horizontal row of filter chips.
 * Tapping a chip updates the parent's filter selection.
 */
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
