/**
 * ReportModal Component
 *
 * Architectural Role:
 * User feedback/content reporting interface. Allows users to flag problematic
 * content (audio issues, wrong content, inappropriate material, etc.). Integrates
 * with backend reporting system via onSubmit callback.
 *
 * Design Patterns:
 * - Modal Form: Controlled form with validation before submission
 * - Category Selection: Predefined categories with optional free-text
 * - Optimistic Feedback: Shows success UI while closing
 *
 * Key Dependencies:
 * - useTheme: Theme styling
 * - Modal from react-native: Bottom-sheet style presentation
 *
 * Consumed By:
 * - Media player header (report button)
 * - Content cards (flagging issues)
 *
 * Design Notes:
 * - No submission without a category (prevents spam)
 * - Description is optional but encouraged for "Other" category
 * - Success feedback auto-closes after 1.5s (UX best practice)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import { ReportCategory } from '@/types';

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  /** Async callback that handles report submission; returns success boolean */
  onSubmit: (category: ReportCategory, description?: string) => Promise<boolean>;
  /** Optional title of reported content (displayed in modal header) */
  contentTitle?: string;
}

/**
 * Predefined report categories with icons and explanatory text.
 * Helps users quickly categorize issues without lengthy descriptions.
 */
const REPORT_CATEGORIES: { id: ReportCategory; label: string; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
  {
    id: 'audio_issue',
    label: 'Audio Issue',
    icon: 'volume-mute-outline',
    description: "Audio doesn't play, cuts off, or has poor quality",
  },
  {
    id: 'wrong_content',
    label: 'Wrong Content',
    icon: 'swap-horizontal-outline',
    description: "Audio doesn't match the title or description",
  },
  {
    id: 'inappropriate',
    label: 'Inappropriate',
    icon: 'warning-outline',
    description: 'Content seems inappropriate or offensive',
  },
  {
    id: 'other',
    label: 'Other',
    icon: 'ellipsis-horizontal-outline',
    description: 'Other issue not listed above',
  },
];

/**
 * ReportModal - Bottom-sheet form for reporting content issues
 *
 * Flow:
 * 1. User selects a category
 * 2. Optionally adds description
 * 3. Submits report
 * 4. Shows success feedback
 * 5. Auto-closes after 1.5s
 */
export function ReportModal({
  visible,
  onClose,
  onSubmit,
  contentTitle,
}: ReportModalProps) {
  const { theme, isDark } = useTheme();
  const styles = React.useMemo(() => createStyles(theme, isDark), [theme, isDark]);

  const [selectedCategory, setSelectedCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  /**
   * Submit Handler:
   * Calls parent's onSubmit with category and optional description.
   * Shows success feedback and auto-closes on success.
   */
  const handleSubmit = async () => {
    if (!selectedCategory) return;

    setIsSubmitting(true);
    const success = await onSubmit(selectedCategory, description.trim() || undefined);
    setIsSubmitting(false);

    if (success) {
      setShowSuccess(true);
      // Auto-close after success feedback is displayed
      setTimeout(() => {
        setShowSuccess(false);
        setSelectedCategory(null);
        setDescription('');
        onClose();
      }, 1500);
    }
  };

  /**
   * Close Handler:
   * Resets form state without submitting.
   */
  const handleClose = () => {
    setSelectedCategory(null);
    setDescription('');
    setShowSuccess(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Report Issue</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          {contentTitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {contentTitle}
            </Text>
          )}

          {showSuccess ? (
            <View style={styles.successContainer}>
              <Ionicons name="checkmark-circle" size={64} color="#4CAF50" />
              <Text style={styles.successText}>Report Submitted</Text>
              <Text style={styles.successSubtext}>Thank you for your feedback</Text>
            </View>
          ) : (
            <>
              {/* Category Options */}
              <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                <View style={styles.categoriesContainer}>
                  {REPORT_CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category.id}
                      style={[
                        styles.categoryOption,
                        selectedCategory === category.id && styles.categoryOptionSelected,
                      ]}
                      onPress={() => setSelectedCategory(category.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[
                        styles.categoryIcon,
                        selectedCategory === category.id && styles.categoryIconSelected,
                      ]}>
                        <Ionicons
                          name={category.icon}
                          size={24}
                          color={selectedCategory === category.id ? 'white' : theme.colors.textSecondary}
                        />
                      </View>
                      <View style={styles.categoryContent}>
                        <Text style={[
                          styles.categoryLabel,
                          selectedCategory === category.id && styles.categoryLabelSelected,
                        ]}>
                          {category.label}
                        </Text>
                        <Text style={styles.categoryDescription} numberOfLines={2}>
                          {category.description}
                        </Text>
                      </View>
                      {selectedCategory === category.id && (
                        <Ionicons name="checkmark-circle" size={24} color={theme.colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Optional Description */}
                <View style={styles.descriptionContainer}>
                  <Text style={styles.descriptionLabel}>Additional Details (Optional)</Text>
                  <TextInput
                    style={styles.descriptionInput}
                    placeholder="Describe the issue in more detail..."
                    placeholderTextColor={theme.colors.textSecondary}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={3}
                    maxLength={500}
                    textAlignVertical="top"
                  />
                  <Text style={styles.charCount}>{description.length}/500</Text>
                </View>
              </ScrollView>

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleClose}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    !selectedCategory && styles.submitButtonDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={!selectedCategory || isSubmitting}
                  activeOpacity={0.7}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={styles.submitButtonText}>Submit Report</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    container: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 20,
      paddingBottom: 40,
      paddingHorizontal: 20,
      maxHeight: '80%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    title: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 22,
      color: theme.colors.text,
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    subtitle: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 20,
    },
    scrollContainer: {
      maxHeight: 350,
    },
    categoriesContainer: {
      gap: 12,
    },
    categoryOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    categoryOptionSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: isDark ? 'rgba(125, 175, 180, 0.15)' : 'rgba(125, 175, 180, 0.1)',
    },
    categoryIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
    },
    categoryIconSelected: {
      backgroundColor: theme.colors.primary,
    },
    categoryContent: {
      flex: 1,
    },
    categoryLabel: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: 4,
    },
    categoryLabelSelected: {
      color: theme.colors.primary,
    },
    categoryDescription: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      color: theme.colors.textSecondary,
      lineHeight: 18,
    },
    descriptionContainer: {
      marginTop: 16,
    },
    descriptionLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: 8,
    },
    descriptionInput: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      borderRadius: 12,
      padding: 14,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.text,
      minHeight: 80,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    },
    charCount: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 12,
      color: theme.colors.textSecondary,
      textAlign: 'right',
      marginTop: 6,
    },
    actions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 24,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 16,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      alignItems: 'center',
    },
    cancelButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: theme.colors.text,
    },
    submitButton: {
      flex: 2,
      paddingVertical: 16,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
    },
    submitButtonDisabled: {
      opacity: 0.5,
    },
    submitButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: 'white',
    },
    successContainer: {
      alignItems: 'center',
      paddingVertical: 40,
    },
    successText: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 20,
      color: theme.colors.text,
      marginTop: 16,
    },
    successSubtext: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginTop: 8,
    },
  });
