/**
 * ARCHITECTURAL ROLE:
 * Content moderation inbox screen. Displays all user-reported content items with filtering
 * and resolution workflow (mark open/resolved with optional admin note).
 *
 * DESIGN PATTERNS:
 * - **MVVM**: useContentManagerReportsInbox hook provides filtered reports and mutations
 * - **State Machine**: Report status is 'open' or 'resolved'; UI offers different actions per state
 * - **Draft Pattern**: noteDrafts state holds in-progress resolution notes per report
 *   Prevents data loss if admin navigates away mid-edit
 *
 * CONSUMERS:
 * - Main navigation: /admin/content/reports
 * - Detail screen navigates back with selectedReportId to show report in sidebar
 * - Badge on main nav shows open count
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import { ReportCategory } from '@/types';
import { ContentManagerFilterPills } from '../components/ContentManagerFilterPills';
import { ContentManagerReportCard } from '../components/ContentManagerReportCard';
import { useContentManagerReportsInbox } from '../hooks/useContentManager';
import {
  CONTENT_MANAGER_COLLECTION_LABELS,
  CONTENT_MANAGER_COLLECTIONS,
  CONTENT_MANAGER_REPORT_CATEGORY_LABELS,
  ContentManagerReportSummary,
} from '../types';

/**
 * Filter pill options for status, type, and category.
 * Generated from type constants and mappings for consistency.
 *
 * STATUS_OPTIONS: Open, Resolved, All (moderation workflow states)
 * TYPE_OPTIONS: All supported content types + "Unsupported" (for unknown content types)
 * CATEGORY_OPTIONS: All report categories (audio_issue, wrong_content, inappropriate, other)
 */
const STATUS_OPTIONS = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
] as const;

const TYPE_OPTIONS = [
  { id: 'all', label: 'All' },
  ...CONTENT_MANAGER_COLLECTIONS.map((collection) => ({
    id: collection,
    label: CONTENT_MANAGER_COLLECTION_LABELS[collection],
  })),
  { id: 'unsupported', label: 'Unsupported' },
] as const;

const CATEGORY_OPTIONS = [
  { id: 'all', label: 'All' },
  ...(Object.entries(CONTENT_MANAGER_REPORT_CATEGORY_LABELS) as Array<[ReportCategory, string]>).map(
    ([id, label]) => ({
      id,
      label,
    })
  ),
] as const;

/**
 * Main reports (moderation inbox) screen component.
 *
 * STATE OVERVIEW:
 * - Hook state: reports, filters, openCount, isLoading, isRefreshing, updatingReportId, error
 * - Local state: noteDrafts (Map of reportId → resolution note draft)
 *
 * INTERACTIONS:
 * - Search bar: substring search across content title/type/description
 * - Filter pills: status (open/resolved), type (collection), category (report reason)
 * - Each report card: resolve (with optional note) or reopen, open linked content
 * - Shows success message on status change (auto-dismisses after 2 seconds)
 */
export default function ContentManagerReportsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const {
    filteredReports,
    filters,
    openCount,
    isLoading,
    isRefreshing,
    updatingReportId,
    error,
    message,
    refresh,
    setQuery,
    setStatus,
    setType,
    setCategory,
    updateStatus,
  } = useContentManagerReportsInbox();

  /**
   * Callback: Update draft resolution note for a report.
   * Stored in local noteDrafts state; cleared after successful save.
   */
  const handleChangeNote = (reportId: string, note: string) => {
    setNoteDrafts((current) => ({
      ...current,
      [reportId]: note,
    }));
  };

  /**
   * Callback: Resolve a report (transition open → resolved).
   * Includes optional resolution note from noteDrafts.
   */
  const handleResolve = async (reportId: string, note?: string) => {
    await updateStatus(reportId, 'resolved', note);
  };

  /**
   * Callback: Reopen a report (transition resolved → open).
   * Clears any existing resolution note.
   */
  const handleReopen = async (reportId: string) => {
    await updateStatus(reportId, 'open');
  };

  /**
   * Callback: Navigate to detail screen for the reported content.
   * Only enabled if report.isSupported (content type is in supported collections).
   * Passes reportId to detail screen so it can highlight this report in the sidebar.
   */
  const handleOpenContent = (report: ContentManagerReportSummary) => {
    if (!report.supportedLink) {
      return;
    }
    router.push({
      pathname: '/admin/content/[collection]/[id]',
      params: {
        collection: report.supportedLink.collection,
        id: report.supportedLink.contentId,
        reportId: report.id,
      },
    });
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={filteredReports}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ContentManagerReportCard
            report={item}
            noteDraft={noteDrafts[item.id]}
            isUpdating={updatingReportId === item.id}
            onChangeNote={handleChangeNote}
            onResolve={handleResolve}
            onReopen={handleReopen}
            onOpenContent={item.supportedLink ? handleOpenContent : undefined}
          />
        )}
        ListHeaderComponent={
          <View style={styles.headerCard}>
            <View style={styles.heroRow}>
              <View style={styles.heroText}>
                <Text style={styles.eyebrow}>Admin</Text>
                <Text style={styles.title}>Reports Inbox</Text>
                <Text style={styles.subtitle}>
                  Review user-submitted content issues, jump into supported content, and
                  resolve reports when they are handled.
                </Text>
                <Text style={styles.summaryText}>
                  {openCount} open report{openCount === 1 ? '' : 's'}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                testID="content-manager-reports-refresh"
                onPress={refresh}
                style={({ pressed }) => [
                  styles.refreshButton,
                  pressed && { opacity: 0.88 },
                ]}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color={theme.colors.textOnPrimary} />
                ) : (
                  <>
                    <Ionicons
                      name="refresh-outline"
                      size={16}
                      color={theme.colors.textOnPrimary}
                    />
                    <Text style={styles.refreshButtonText}>Refresh</Text>
                  </>
                )}
              </Pressable>
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
              <TextInput
                value={filters.query}
                onChangeText={setQuery}
                placeholder="Search by content title, id, or raw content type"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.searchInput}
              />
            </View>

            <ContentManagerFilterPills
              label="Status"
              options={STATUS_OPTIONS}
              selectedId={filters.status}
              onChange={setStatus}
            />

            <ContentManagerFilterPills
              label="Type"
              options={TYPE_OPTIONS}
              selectedId={filters.type}
              onChange={setType}
            />

            <ContentManagerFilterPills
              label="Category"
              options={CATEGORY_OPTIONS}
              selectedId={filters.category}
              onChange={setCategory}
            />

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {message ? (
              <View style={styles.messageCard}>
                <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.success} />
                <Text style={styles.messageText}>{message}</Text>
              </View>
            ) : null}

            {!isLoading ? (
              <Text style={styles.resultsText}>
                {filteredReports.length} report{filteredReports.length === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.emptyTitle}>Loading reports</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="flag-outline" size={40} color={theme.colors.textMuted} />
              <Text style={styles.emptyTitle}>No matching reports</Text>
              <Text style={styles.emptyBody}>
                Try a different filter or search term.
              </Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingHorizontal: Platform.OS === 'web' ? 24 : 0,
    },
    listContent: {
      width: '100%',
      maxWidth: Platform.OS === 'web' ? 1080 : undefined,
      alignSelf: 'center',
      paddingHorizontal: Platform.OS === 'web' ? 0 : 16,
      paddingTop: 16,
      paddingBottom: 40,
    },
    headerCard: {
      gap: 18,
      marginBottom: 18,
      padding: 20,
      borderRadius: theme.borderRadius.xl,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.shadows.sm,
    },
    heroRow: {
      flexDirection: Platform.OS === 'web' ? 'row' : 'column',
      justifyContent: 'space-between',
      gap: 16,
    },
    heroText: {
      flex: 1,
      gap: 6,
    },
    eyebrow: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 1,
      color: theme.colors.primary,
    },
    title: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 30,
      color: theme.colors.text,
    },
    subtitle: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 15,
      lineHeight: 22,
      color: theme.colors.textSecondary,
      maxWidth: 760,
    },
    summaryText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    refreshButton: {
      alignSelf: Platform.OS === 'web' ? 'flex-start' : 'stretch',
      minWidth: 112,
      height: 42,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    refreshButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.textOnPrimary,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'web' ? 14 : 10,
    },
    searchInput: {
      flex: 1,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.text,
    },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: theme.borderRadius.md,
      backgroundColor: `${theme.colors.error}14`,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    errorText: {
      flex: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.error,
    },
    messageCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: theme.borderRadius.md,
      backgroundColor: `${theme.colors.success}14`,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    messageText: {
      flex: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.success,
    },
    resultsText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 48,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 18,
      color: theme.colors.text,
    },
    emptyBody: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 14,
      lineHeight: 21,
      textAlign: 'center',
      color: theme.colors.textSecondary,
      maxWidth: 420,
    },
  });
