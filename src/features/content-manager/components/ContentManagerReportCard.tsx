import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import {
  CONTENT_MANAGER_REPORT_CATEGORY_LABELS,
  CONTENT_MANAGER_REPORT_STATUS_LABELS,
  ContentManagerReportSummary,
} from '../types';

function formatReportedAt(report: ContentManagerReportSummary): string {
  const date = report.reportedAt?.toDate?.();
  if (!date) {
    return 'Just now';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

interface Props {
  report: ContentManagerReportSummary;
  noteDraft?: string;
  isUpdating?: boolean;
  selected?: boolean;
  onChangeNote: (reportId: string, note: string) => void;
  onResolve: (reportId: string, note?: string) => void;
  onReopen: (reportId: string) => void;
  onOpenContent?: (report: ContentManagerReportSummary) => void;
}

export function ContentManagerReportCard({
  report,
  noteDraft,
  isUpdating,
  selected,
  onChangeNote,
  onResolve,
  onReopen,
  onOpenContent,
}: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      testID={`content-manager-report-${report.id}`}
      style={[
        styles.card,
        selected && styles.cardSelected,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>
              {report.contentTitle || report.contentIdentifier || report.contentId}
            </Text>
            {!report.isSupported ? (
              <View style={styles.unsupportedBadge}>
                <Text style={styles.unsupportedBadgeText}>Unsupported</Text>
              </View>
            ) : null}
            {selected ? (
              <View style={styles.selectedBadge}>
                <Text style={styles.selectedBadgeText}>Selected</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.meta}>
            {report.contentTypeLabel || report.contentType} • {report.contentIdentifier || report.contentId}
          </Text>
          <Text style={styles.meta}>
            {CONTENT_MANAGER_REPORT_CATEGORY_LABELS[report.category]} •{' '}
            {CONTENT_MANAGER_REPORT_STATUS_LABELS[report.status]} • {formatReportedAt(report)}
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            report.status === 'resolved' ? styles.statusBadgeResolved : styles.statusBadgeOpen,
          ]}
        >
          <Text style={styles.statusBadgeText}>
            {CONTENT_MANAGER_REPORT_STATUS_LABELS[report.status]}
          </Text>
        </View>
      </View>

      {report.description ? (
        <Text style={styles.description}>{report.description}</Text>
      ) : (
        <Text style={styles.descriptionMuted}>No extra details provided.</Text>
      )}

      {report.status === 'resolved' && report.resolutionNote ? (
        <Text style={styles.resolutionNote}>Resolution note: {report.resolutionNote}</Text>
      ) : null}

      {report.status === 'resolved' && (report.resolvedByEmail || report.resolvedByUid) ? (
        <Text style={styles.resolutionMeta}>
          Resolved by {report.resolvedByEmail || report.resolvedByUid}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {onOpenContent ? (
          <Pressable
            testID={`content-manager-report-open-${report.id}`}
            onPress={() => onOpenContent(report)}
            style={({ pressed }) => [styles.secondaryAction, pressed && { opacity: 0.88 }]}
          >
            <Ionicons name="open-outline" size={16} color={theme.colors.text} />
            <Text style={styles.secondaryActionText}>Open Content</Text>
          </Pressable>
        ) : null}

        {report.status === 'open' ? (
          <>
            <TextInput
              testID={`content-manager-report-note-${report.id}`}
              value={noteDraft || ''}
              onChangeText={(value) => onChangeNote(report.id, value)}
              placeholder="Resolution note (optional)"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.noteInput}
            />
            <Pressable
              testID={`content-manager-report-resolve-${report.id}`}
              onPress={() => onResolve(report.id, noteDraft)}
              disabled={Boolean(isUpdating)}
              style={({ pressed }) => [
                styles.primaryAction,
                Boolean(isUpdating) && styles.primaryActionDisabled,
                pressed && !isUpdating && { opacity: 0.88 },
              ]}
            >
              {isUpdating ? (
                <ActivityIndicator size="small" color={theme.colors.textOnPrimary} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.textOnPrimary} />
                  <Text style={styles.primaryActionText}>Resolve</Text>
                </>
              )}
            </Pressable>
          </>
        ) : (
          <Pressable
            testID={`content-manager-report-reopen-${report.id}`}
            onPress={() => onReopen(report.id)}
            disabled={Boolean(isUpdating)}
            style={({ pressed }) => [
              styles.secondaryAction,
              Boolean(isUpdating) && styles.secondaryActionDisabled,
              pressed && !isUpdating && { opacity: 0.88 },
            ]}
          >
            {isUpdating ? (
              <ActivityIndicator size="small" color={theme.colors.text} />
            ) : (
              <>
                <Ionicons name="refresh-outline" size={16} color={theme.colors.text} />
                <Text style={styles.secondaryActionText}>Reopen</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      gap: 12,
      padding: 14,
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    cardSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: `${theme.colors.primary}08`,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    headerText: {
      flex: 1,
      gap: 4,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    title: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 15,
      color: theme.colors.text,
    },
    meta: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    description: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textSecondary,
    },
    descriptionMuted: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    statusBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: theme.borderRadius.full,
    },
    statusBadgeOpen: {
      backgroundColor: `${theme.colors.warning}22`,
    },
    statusBadgeResolved: {
      backgroundColor: `${theme.colors.success}22`,
    },
    statusBadgeText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 11,
      color: theme.colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    unsupportedBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: theme.borderRadius.full,
      backgroundColor: `${theme.colors.error}18`,
    },
    unsupportedBadgeText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 11,
      color: theme.colors.error,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    selectedBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: theme.borderRadius.full,
      backgroundColor: `${theme.colors.primary}18`,
    },
    selectedBadgeText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 11,
      color: theme.colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    resolutionNote: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.textSecondary,
    },
    resolutionMeta: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    actions: {
      gap: 10,
    },
    noteInput: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.text,
    },
    primaryAction: {
      minHeight: 42,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryActionDisabled: {
      opacity: 0.5,
    },
    primaryActionText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.textOnPrimary,
    },
    secondaryAction: {
      minHeight: 42,
      borderRadius: theme.borderRadius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceElevated,
      paddingHorizontal: 16,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    secondaryActionDisabled: {
      opacity: 0.5,
    },
    secondaryActionText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.text,
    },
  });
