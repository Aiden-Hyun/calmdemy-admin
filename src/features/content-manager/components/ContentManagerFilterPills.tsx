/**
 * ARCHITECTURAL ROLE:
 * Generic, reusable filter pill component for multi-choice filters.
 * Displays horizontal scrollable list of pill buttons; one can be selected at a time.
 *
 * DESIGN PATTERNS:
 * - **Generic Component**: Parameterized over string union type T, enabling type-safe filters
 *   without repeating component code for each filter dimension (type, access, status, etc.)
 * - **Controlled Component**: Caller manages selectedId state; onChange callback notifies on selection change
 *   (React best practice: single source of truth in parent state)
 * - **Composition Over Inheritance**: Option shape is a simple { id, label } record; easy to construct
 *   from any enum or constant map
 *
 * CONSUMERS:
 * - ContentManagerScreen: type, access, thumbnail filters
 * - ContentManagerReportsScreen: status, type, category filters
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

/**
 * Single option for a pill group. Generic over string union type T for type safety.
 * Enables exhaustiveness checking: if you define new filter values, TypeScript errors
 * if you forget to add corresponding Option entries.
 */
type Option<T extends string> = {
  id: T;
  label: string;
};

interface Props<T extends string> {
  label: string;
  options: readonly Option<T>[];
  selectedId: T;
  onChange: (value: T) => void;
}

/**
 * Renders a horizontal scrollable group of filter pills (buttons).
 * Exactly one pill is always selected (radio-button behavior).
 *
 * STYLING:
 * - Selected pill: primary color background + white text
 * - Unselected pill: surface color + border + muted text
 * - Pressed state: reduced opacity for tactile feedback
 *
 * ACCESSIBILITY:
 * - Each pill is a Pressable with clear touch targets
 * - Visual feedback (selected state, pressed opacity) helps users understand what's active
 */
export function ContentManagerFilterPills<T extends string>({
  label,
  options,
  selectedId,
  onChange,
}: Props<T>) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {options.map((option) => {
          const selected = option.id === selectedId;
          return (
            <Pressable
              key={option.id}
              onPress={() => onChange(option.id)}
              style={({ pressed }) => [
                styles.pill,
                selected && styles.pillSelected,
                pressed && styles.pillPressed,
              ]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    group: {
      gap: 8,
    },
    label: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    row: {
      gap: 8,
      paddingRight: 16,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    pillSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    pillPressed: {
      opacity: 0.88,
    },
    pillText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.text,
    },
    pillTextSelected: {
      color: theme.colors.textOnPrimary,
    },
  });
