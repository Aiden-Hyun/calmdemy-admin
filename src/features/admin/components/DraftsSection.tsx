/**
 * Display list of locally saved draft jobs.
 *
 * ARCHITECTURAL ROLE:
 * Shows previews of draft jobs with quick actions (load, delete).
 * Drafts are stored in local AsyncStorage; not persisted to Firestore.
 *
 * DESIGN PATTERN:
 * - Card list: Each draft shown as pressable card with metadata
 * - Quick actions: Delete button (with event propagation stop)
 * - Smart labeling: Different labels for courses, subjects, single content
 * - Time display: Shows "Updated X ago" for LRU-like UX
 *
 * VISIBILITY LOGIC:
 * Section renders only if drafts.length > 0.
 * Useful for offline work: users can save incomplete forms to resume later.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { ContentDraft, CONTENT_TYPE_LABELS } from '../types';
import { Theme } from '@/theme';

interface DraftsSectionProps {
  drafts: ContentDraft[];
  onDelete: (draftId: string) => void;
  onSelect: (draftId: string) => void;
}

export function DraftsSection({ drafts, onDelete, onSelect }: DraftsSectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (drafts.length === 0) {
    return null;
  }

  return (
    <View style={styles.draftsSection}>
      <View style={styles.draftsHeader}>
        <Text style={styles.draftsTitle}>Drafts</Text>
        <Text style={styles.draftsCount}>{drafts.length}</Text>
      </View>
      <View style={styles.draftsList}>
        {drafts.map((draft) => (
          <Pressable
            key={draft.id}
            style={({ pressed }) => [
              styles.draftCard,
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => onSelect(draft.id)}
          >
            <View style={styles.draftRow}>
              <View style={styles.draftBadge}>
                <Text style={styles.draftBadgeText}>Draft</Text>
              </View>
              <Pressable
                onPress={(event) => {
                  event.stopPropagation();
                  onDelete(draft.id);
                }}
                style={({ pressed }) => [
                  styles.draftDelete,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
              </Pressable>
            </View>
            <Text style={styles.draftLabel} numberOfLines={2}>
              {getDraftLabel(draft)}
            </Text>
            <Text style={styles.draftMeta}>
              Updated {formatDraftTime(draft.updatedAt)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function getDraftLabel(draft: ContentDraft): string {
  const totalSubjectCourses =
    (draft.levelCounts?.l100 || 0) +
    (draft.levelCounts?.l200 || 0) +
    (draft.levelCounts?.l300 || 0) +
    (draft.levelCounts?.l400 || 0);
  const base =
    draft.contentType === 'course'
      ? (draft.courseTitle || draft.topic)
      : draft.contentType === 'full_subject'
        ? draft.subjectId
          ? `${draft.subjectId.toUpperCase()} (${totalSubjectCourses} courses)`
          : ''
      : (draft.title || draft.topic);
  const typeLabel = CONTENT_TYPE_LABELS[draft.contentType] || 'Content';
  if (base) {
    return `${typeLabel}: ${base}`;
  }
  return `${typeLabel} Draft`;
}

function formatDraftTime(updatedAt: number): string {
  if (!updatedAt) return 'unknown';
  return new Date(updatedAt).toLocaleString();
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    draftsSection: {
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    draftsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    draftsTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 16,
      color: theme.colors.text,
    },
    draftsCount: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    draftsList: {
      gap: 10,
    },
    draftCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      padding: 14,
    },
    draftRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    draftBadge: {
      backgroundColor: `${theme.colors.warning}25`,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
    },
    draftBadgeText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.warning,
    },
    draftDelete: {
      padding: 4,
    },
    draftLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 14,
      color: theme.colors.text,
      lineHeight: 20,
    },
    draftMeta: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
      marginTop: 6,
    },
  });
