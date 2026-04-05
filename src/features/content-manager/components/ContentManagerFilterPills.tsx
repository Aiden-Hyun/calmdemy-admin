import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

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
