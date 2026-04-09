import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

export interface ChipOption {
  id: string;
  label: string;
}

interface ChipGroupProps {
  options: ChipOption[];
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
  multiSelect?: boolean;
  customValue?: string;
  onCustomValueChange?: (v: string) => void;
  customPlaceholder?: string;
}

export function ChipGroup({
  options,
  selected,
  onSelectionChange,
  multiSelect = false,
  customValue,
  onCustomValueChange,
  customPlaceholder = 'Custom...',
}: ChipGroupProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [showCustomInput, setShowCustomInput] = useState(false);

  const isCustomActive = showCustomInput || (customValue != null && customValue.length > 0 && selected.length === 0);

  const handleChipPress = (id: string) => {
    if (isCustomActive) {
      setShowCustomInput(false);
      onCustomValueChange?.('');
    }

    if (multiSelect) {
      if (selected.includes(id)) {
        onSelectionChange(selected.filter((s) => s !== id));
      } else {
        onSelectionChange([...selected, id]);
      }
    } else {
      onSelectionChange(selected.includes(id) ? [] : [id]);
    }
  };

  const handleCustomPress = () => {
    setShowCustomInput(true);
    onSelectionChange([]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <Pressable
              key={option.id}
              style={({ pressed }) => [
                styles.chip,
                isSelected && styles.chipSelected,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => handleChipPress(option.id)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
        {onCustomValueChange != null && (
          <Pressable
            style={({ pressed }) => [
              styles.chip,
              isCustomActive && styles.chipSelected,
              pressed && { opacity: 0.8 },
            ]}
            onPress={handleCustomPress}
          >
            <Ionicons
              name="pencil"
              size={12}
              color={isCustomActive ? '#fff' : theme.colors.textMuted}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.chipText, isCustomActive && styles.chipTextSelected]}>
              Custom
            </Text>
          </Pressable>
        )}
      </View>
      {isCustomActive && onCustomValueChange != null && (
        <TextInput
          style={styles.customInput}
          placeholder={customPlaceholder}
          placeholderTextColor={theme.colors.textMuted}
          value={customValue}
          onChangeText={onCustomValueChange}
          autoFocus
        />
      )}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: 8,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
    },
    chipSelected: {
      backgroundColor: theme.colors.primary,
    },
    chipText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 13,
      color: theme.colors.text,
    },
    chipTextSelected: {
      color: '#fff',
    },
    customInput: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontFamily: 'DMSans-Regular',
      fontSize: 14,
      color: theme.colors.text,
    },
  });
