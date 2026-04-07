import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

export interface RadioOption {
  id: string;
  label: string;
  description?: string;
}

interface RadioGroupProps {
  options: RadioOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function RadioGroup({ options, selectedId, onSelect }: RadioGroupProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.container}>
      {options.map((option) => {
        const isSelected = option.id === selectedId;
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
  });
