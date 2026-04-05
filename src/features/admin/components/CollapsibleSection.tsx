import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

export interface SummaryItem {
  label: string;
  value: string;
}

interface CollapsibleSectionProps {
  title: string;
  summaryItems?: SummaryItem[];
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  summaryItems = [],
  expanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{title}</Text>
          {!expanded && summaryItems.length > 0 && (
            <View style={styles.summaryRow}>
              {summaryItems.map((item, index) => (
                <View key={`${item.label}-${index}`} style={styles.chip}>
                  <Text style={styles.chipLabel}>{item.label}:</Text>
                  <Text style={styles.chipValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.colors.textMuted}
        />
      </Pressable>
      {expanded && (
        <>
          <View style={styles.divider} />
          <View style={styles.content}>{children}</View>
        </>
      )}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      ...theme.shadows.sm,
      marginBottom: 20,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerPressed: {
      opacity: 0.9,
    },
    headerLeft: {
      flex: 1,
      paddingRight: 12,
    },
    title: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 15,
      color: theme.colors.text,
      marginBottom: 8,
    },
    summaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: theme.colors.gray[100],
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
    },
    chipLabel: {
      fontFamily: 'DMSans-Medium',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    chipValue: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.text,
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.gray[200],
      marginTop: 10,
      marginBottom: 12,
    },
    content: {
      paddingBottom: 4,
    },
  });
