/**
 * ARCHITECTURAL ROLE:
 * Content item result card for catalog listing. Displays summary info (title, type, duration),
 * optional regeneration status/action, and visual indicators (access level, thumbnail quality badges).
 *
 * DESIGN PATTERNS:
 * - **Presentational Component**: Pure component, no local state or hooks (except useMemo for styles)
 *   All behavior driven by props callbacks (onPress, onRegenerate)
 * - **Conditional Rendering**: Shows different UI based on showRegenerate flag and regenerationStatus
 *   Supports multiple modes: view-only, regeneration pending, regeneration complete, thumbnail QA
 * - **Visual Status Indicators**: Collection-specific icons, access badges (free/premium),
 *   thumbnail quality badges (missing/web), regeneration status pills with spinner
 *
 * CONSUMERS:
 * - ContentManagerScreen FlatList rendering catalog items
 * - Can switch to regeneration mode to show status during factory jobs
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import { JobStatus } from '@features/admin/types';
import { ContentManagerItemSummary, isWebStockThumbnail } from '../types';

/**
 * Wraps factory job status and regeneration progress info for display in the card.
 * Used by ContentManagerScreen to show inline regeneration feedback (spinner, success, error states).
 */
export interface RegenerationStatusInfo {
  jobId?: string;
  status: JobStatus | 'no_job' | 'error' | 'unsupported';
  label: string;
  completedAt?: string;
}

interface Props {
  item: ContentManagerItemSummary;
  onPress: () => void;
  showRegenerate?: boolean;
  isSubmitting?: boolean;
  regenerationStatus?: RegenerationStatusInfo;
  onRegenerate?: () => void;
}

/**
 * Formats duration in minutes to UI-friendly string (e.g., "23 min").
 * Returns null if missing or invalid, used to conditionally render duration badge.
 */
function formatDuration(durationMinutes?: number): string | null {
  if (!durationMinutes || durationMinutes <= 0) return null;
  return `${durationMinutes} min`;
}

/**
 * Maps content collection type to Ionicon name for visual type identification.
 * Each content type gets its own icon (leaf for meditations, book for stories, etc.)
 * providing visual scannability in long lists.
 */
function iconForCollection(collection: ContentManagerItemSummary['collection']) {
  switch (collection) {
    case 'guided_meditations':
      return 'leaf-outline';
    case 'sleep_meditations':
      return 'moon-outline';
    case 'bedtime_stories':
      return 'book-outline';
    case 'emergency_meditations':
      return 'flash-outline';
    case 'courses':
      return 'school-outline';
    case 'course_sessions':
      return 'reader-outline';
    case 'albums':
      return 'disc-outline';
    case 'sleep_sounds':
      return 'cloudy-night-outline';
    case 'background_sounds':
      return 'volume-low-outline';
    case 'white_noise':
      return 'radio-outline';
    case 'music':
      return 'musical-notes-outline';
    case 'asmr':
      return 'headset-outline';
    case 'series':
      return 'library-outline';
    case 'breathing_exercises':
      return 'fitness-outline';
    case 'meditation_programs':
      return 'calendar-outline';
    default:
      return 'document-text-outline';
  }
}

/**
 * Maps factory job status to appropriate Ionicon name for status pill.
 * Visual feedback: pending→clock, generating→sparkles, done→checkmark, error→alert.
 */
function statusIcon(status: RegenerationStatusInfo['status']): keyof typeof Ionicons.glyphMap {
  switch (status) {
    case 'pending':
      return 'time-outline';
    case 'image_generating':
      return 'sparkles-outline';
    case 'completed':
      return 'checkmark-circle-outline';
    case 'failed':
    case 'error':
      return 'alert-circle-outline';
    case 'no_job':
      return 'help-circle-outline';
    case 'unsupported':
      return 'information-circle-outline';
    default:
      return 'ellipsis-horizontal';
  }
}

/**
 * Predicate: status is an error state (job failed, no job found, content type unsupported for regen).
 * Used to style status pill with error colors (red).
 */
function isErrorStatus(status: RegenerationStatusInfo['status']): boolean {
  return status === 'failed' || status === 'error' || status === 'no_job' || status === 'unsupported';
}

/**
 * Predicate: status is an active/in-progress state (job pending or currently generating).
 * Used to show spinner instead of static icon in status pill.
 */
function isActiveStatus(status: RegenerationStatusInfo['status']): boolean {
  return status === 'pending' || status === 'image_generating';
}

/**
 * Main render function for content result card.
 * Displays: thumbnail/placeholder, title, type/identifier metadata, access badge,
 * optional description, and optional regeneration controls.
 *
 * LAYOUT:
 * - Row container: thumbnail (left, fixed 72x72) + body (flex, right)
 * - Body: title row, metadata row, description, regeneration section
 *
 * INTERACTIONS:
 * - onPress: Navigate to detail screen
 * - onRegenerate: Trigger thumbnail regeneration (if button shown)
 * - Tests use testID combining collection + item id for finding specific cards
 */
export function ContentManagerResultCard({
  item,
  onPress,
  showRegenerate,
  isSubmitting,
  regenerationStatus,
  onRegenerate,
}: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const durationLabel = formatDuration(item.durationMinutes);
  const thumbnailStatus = !item.thumbnailUrl
    ? 'missing'
    : isWebStockThumbnail(item.thumbnailUrl)
      ? 'web'
      : null;

  return (
    <Pressable
      testID={`content-manager-item-${item.collection}-${item.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {item.thumbnailUrl ? (
        <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons
            name={iconForCollection(item.collection)}
            size={24}
            color={theme.colors.primary}
          />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          {showRegenerate && thumbnailStatus ? (
            <View
              style={[
                styles.thumbnailBadge,
                thumbnailStatus === 'missing'
                  ? styles.thumbnailMissingBadge
                  : styles.thumbnailWebBadge,
              ]}
            >
              <Text style={styles.thumbnailBadgeText}>
                {thumbnailStatus === 'missing' ? 'No Image' : 'Web URL'}
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.accessBadge,
              item.access === 'premium'
                ? styles.premiumBadge
                : styles.freeBadge,
            ]}
          >
            <Text style={styles.accessBadgeText}>
              {item.access === 'premium' ? 'Premium' : 'Free'}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.typeLabel}>{item.typeLabel}</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.identifier} numberOfLines={1}>
            {item.identifier}
          </Text>
          {durationLabel ? (
            <>
              <Text style={styles.metaDot}>•</Text>
              <Text style={styles.duration}>{durationLabel}</Text>
            </>
          ) : null}
        </View>

        {item.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : (
          <Text style={styles.descriptionMuted}>No description</Text>
        )}

        {showRegenerate ? (
          regenerationStatus ? (
            <View
              style={[
                styles.statusPill,
                regenerationStatus.status === 'completed'
                  ? styles.statusPillSuccess
                  : isErrorStatus(regenerationStatus.status)
                    ? styles.statusPillError
                    : styles.statusPillActive,
              ]}
            >
              {isActiveStatus(regenerationStatus.status) ? (
                <ActivityIndicator
                  size={12}
                  color={
                    regenerationStatus.status === 'pending'
                      ? theme.colors.textMuted
                      : theme.colors.primary
                  }
                />
              ) : (
                <Ionicons
                  name={statusIcon(regenerationStatus.status)}
                  size={14}
                  color={
                    regenerationStatus.status === 'completed'
                      ? theme.colors.success
                      : isErrorStatus(regenerationStatus.status)
                        ? theme.colors.error
                        : theme.colors.textMuted
                  }
                />
              )}
              <Text
                style={[
                  styles.statusPillText,
                  regenerationStatus.status === 'completed' && {
                    color: theme.colors.success,
                  },
                  isErrorStatus(regenerationStatus.status) && {
                    color: theme.colors.error,
                  },
                ]}
                numberOfLines={2}
              >
                {regenerationStatus.label}
              </Text>
            </View>
          ) : onRegenerate ? (
            <Pressable
              testID={`content-manager-regenerate-${item.collection}-${item.id}`}
              onPress={(e) => {
                e.stopPropagation();
                onRegenerate();
              }}
              disabled={isSubmitting}
              style={({ pressed }) => [
                styles.regenerateButton,
                pressed && { opacity: 0.8 },
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={theme.colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons name="image-outline" size={14} color={theme.colors.textOnPrimary} />
                  <Text style={styles.regenerateButtonText}>Regenerate Image</Text>
                </>
              )}
            </Pressable>
          ) : null
        ) : null}
      </View>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      gap: 14,
      padding: 14,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cardPressed: {
      opacity: 0.9,
    },
    thumbnail: {
      width: 72,
      height: 72,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.gray[200],
    },
    placeholder: {
      width: 72,
      height: 72,
      borderRadius: theme.borderRadius.md,
      backgroundColor: `${theme.colors.primary}14`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: {
      flex: 1,
      gap: 6,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    title: {
      flex: 1,
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: theme.colors.text,
    },
    accessBadge: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: theme.borderRadius.full,
    },
    premiumBadge: {
      backgroundColor: `${theme.colors.secondary}26`,
    },
    freeBadge: {
      backgroundColor: `${theme.colors.success}20`,
    },
    accessBadgeText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 11,
      color: theme.colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
    },
    typeLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    metaDot: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    identifier: {
      flexShrink: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.text,
    },
    duration: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    description: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textSecondary,
    },
    descriptionMuted: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    thumbnailBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: theme.borderRadius.full,
    },
    thumbnailMissingBadge: {
      backgroundColor: `${theme.colors.error}20`,
    },
    thumbnailWebBadge: {
      backgroundColor: `${theme.colors.warning}20`,
    },
    thumbnailBadgeText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 10,
      color: theme.colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    regenerateButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.primary,
    },
    regenerateButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 12,
      color: theme.colors.textOnPrimary,
    },
    statusPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: theme.borderRadius.full,
      borderWidth: 1,
    },
    statusPillActive: {
      backgroundColor: `${theme.colors.primary}10`,
      borderColor: `${theme.colors.primary}30`,
    },
    statusPillSuccess: {
      backgroundColor: `${theme.colors.success}12`,
      borderColor: `${theme.colors.success}30`,
    },
    statusPillError: {
      backgroundColor: `${theme.colors.error}12`,
      borderColor: `${theme.colors.error}30`,
    },
    statusPillText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
  });
