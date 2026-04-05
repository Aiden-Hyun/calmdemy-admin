import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Unsubscribe } from 'firebase/firestore';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import {
  createThumbnailOnlyJob,
  getLatestCompletedCourseJobForCourseId,
  getLatestCompletedJobForContentId,
  requestContentThumbnailGeneration,
  requestCourseThumbnailGeneration,
  subscribeToJob,
} from '@features/admin/data/adminRepository';
import { JOB_STATUS_LABELS, JobStatus } from '@features/admin/types';
import { ContentManagerFilterPills } from '../components/ContentManagerFilterPills';
import { ContentManagerResultCard } from '../components/ContentManagerResultCard';
import {
  useContentManagerCatalog,
  useContentManagerReportsSummary,
} from '../hooks/useContentManager';
import {
  CONTENT_MANAGER_COLLECTION_LABELS,
  CONTENT_MANAGER_COLLECTIONS,
  ContentManagerItemSummary,
} from '../types';

const TYPE_OPTIONS = [
  { id: 'all', label: 'All' },
  ...CONTENT_MANAGER_COLLECTIONS.map((collection) => ({
    id: collection,
    label: CONTENT_MANAGER_COLLECTION_LABELS[collection],
  })),
] as const;

const ACCESS_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free' },
  { id: 'premium', label: 'Premium' },
] as const;

const THUMBNAIL_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'missing_or_web', label: 'Missing / Web URL' },
] as const;

export default function ContentManagerScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const {
    filteredItems,
    filters,
    isLoading,
    isRefreshing,
    error,
    refresh,
    setAccess,
    setQuery,
    setType,
    setThumbnail,
  } = useContentManagerCatalog();
  const { openCount } = useContentManagerReportsSummary();

  // Track regeneration status per content item
  const [regenStatus, setRegenStatus] = useState<
    Map<string, { jobId?: string; status: JobStatus | 'no_job' | 'error' | 'unsupported'; label: string; completedAt?: string }>
  >(new Map());
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const unsubscribesRef = useRef<Map<string, Unsubscribe>>(new Map());
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up all subscriptions and timers on unmount
  useEffect(() => {
    return () => {
      for (const unsub of unsubscribesRef.current.values()) unsub();
      for (const timer of dismissTimersRef.current.values()) clearTimeout(timer);
    };
  }, []);

  const setStatusWithAutoDismiss = useCallback(
    (contentId: string, entry: { jobId?: string; status: 'no_job' | 'error' | 'unsupported'; label: string }) => {
      // Clear any existing subscription/timer
      unsubscribesRef.current.get(contentId)?.();
      unsubscribesRef.current.delete(contentId);
      const existingTimer = dismissTimersRef.current.get(contentId);
      if (existingTimer) clearTimeout(existingTimer);

      setRegenStatus((prev) => {
        const next = new Map(prev);
        next.set(contentId, entry);
        return next;
      });

      const timer = setTimeout(() => {
        setRegenStatus((prev) => {
          const next = new Map(prev);
          next.delete(contentId);
          return next;
        });
        dismissTimersRef.current.delete(contentId);
      }, 8_000);
      dismissTimersRef.current.set(contentId, timer);
    },
    []
  );

  const startWatchingJob = useCallback((contentId: string, jobId: string) => {
    // Cancel any existing subscription for this content item
    unsubscribesRef.current.get(contentId)?.();
    const existingTimer = dismissTimersRef.current.get(contentId);
    if (existingTimer) clearTimeout(existingTimer);

    setRegenStatus((prev) => {
      const next = new Map(prev);
      next.set(contentId, { jobId, status: 'pending', label: 'Queued' });
      return next;
    });

    const unsub = subscribeToJob(jobId, (updatedJob) => {
      if (!updatedJob) return;

      const status = updatedJob.status;
      const isTerminal = status === 'completed' || status === 'failed';
      let completedAt: string | undefined;

      if (status === 'completed' && updatedJob.runEndedAt?.toDate) {
        completedAt = updatedJob.runEndedAt.toDate().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        });
      }

      const label =
        status === 'completed' && completedAt
          ? `Finished at ${completedAt}`
          : status === 'failed'
            ? updatedJob.error || 'Failed'
            : status === 'pending'
              ? 'Queued'
              : JOB_STATUS_LABELS[status] || status;

      setRegenStatus((prev) => {
        const next = new Map(prev);
        next.set(contentId, { jobId, status, label, completedAt });
        return next;
      });

      if (isTerminal) {
        // Unsubscribe once terminal
        unsubscribesRef.current.get(contentId)?.();
        unsubscribesRef.current.delete(contentId);

        // Auto-dismiss after 15 seconds
        const timer = setTimeout(() => {
          setRegenStatus((prev) => {
            const next = new Map(prev);
            next.delete(contentId);
            return next;
          });
          dismissTimersRef.current.delete(contentId);
        }, 15_000);
        dismissTimersRef.current.set(contentId, timer);
      }
    });

    unsubscribesRef.current.set(contentId, unsub);
  }, []);

  const NO_THUMBNAIL_COLLECTIONS = ['course_sessions', 'background_sounds', 'breathing_exercises', 'meditation_programs'];

  const handleRegenerate = useCallback(async (item: ContentManagerItemSummary) => {
    if (NO_THUMBNAIL_COLLECTIONS.includes(item.collection)) {
      setStatusWithAutoDismiss(item.id, {
        status: 'unsupported',
        label: item.collection === 'course_sessions'
          ? 'Regenerate the parent course instead'
          : 'This content type does not support thumbnails',
      });
      return;
    }

    setSubmittingIds((prev) => new Set(prev).add(item.id));
    try {
      let jobId: string;

      if (item.collection === 'courses') {
        const job = await getLatestCompletedCourseJobForCourseId(item.id);
        if (job) {
          await requestCourseThumbnailGeneration(job);
          jobId = job.id;
        } else {
          // Course with no factory job — create a thumbnail-only job
          jobId = await createThumbnailOnlyJob({
            contentId: item.id,
            collection: item.collection,
            title: item.title,
            description: item.description,
          });
        }
      } else {
        const job = await getLatestCompletedJobForContentId(item.id);
        if (job) {
          await requestContentThumbnailGeneration(job);
          jobId = job.id;
        } else {
          // Seeded content with no factory job — create a thumbnail-only job
          jobId = await createThumbnailOnlyJob({
            contentId: item.id,
            collection: item.collection,
            title: item.title,
            description: item.description,
          });
        }
      }

      startWatchingJob(item.id, jobId);
    } catch (regenerateError) {
      setStatusWithAutoDismiss(item.id, {
        status: 'error',
        label:
          regenerateError instanceof Error
            ? regenerateError.message
            : 'Failed to request regeneration',
      });
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [startWatchingJob, setStatusWithAutoDismiss]);

  return (
    <View style={styles.screen}>
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => `${item.collection}:${item.id}`}
        renderItem={({ item }) => (
          <ContentManagerResultCard
            item={item}
            showRegenerate={filters.thumbnail === 'missing_or_web'}
            isSubmitting={submittingIds.has(item.id)}
            regenerationStatus={regenStatus.get(item.id)}
            onRegenerate={() => handleRegenerate(item)}
            onPress={() =>
              router.push({
                pathname: '/admin/content/[collection]/[id]',
                params: {
                  collection: item.collection,
                  id: item.id,
                },
              })
            }
          />
        )}
        ListHeaderComponent={
          <View style={styles.headerCard}>
            <View style={styles.heroRow}>
              <View style={styles.heroText}>
                <Text style={styles.eyebrow}>Admin</Text>
                <Text style={styles.title}>Content Manager</Text>
                <Text style={styles.subtitle}>
                  Find published content, inspect metadata, and jump into the live experience.
                </Text>
                <Text style={styles.reportsHint}>
                  {openCount} open report{openCount === 1 ? '' : 's'}
                </Text>
              </View>

              <View style={styles.heroActions}>
                <Pressable
                  accessibilityRole="button"
                  testID="content-manager-open-reports"
                  onPress={() => router.push('/admin/content/reports')}
                  style={({ pressed }) => [
                    styles.secondaryHeroButton,
                    pressed && { opacity: 0.88 },
                  ]}
                >
                  <Ionicons name="flag-outline" size={16} color={theme.colors.text} />
                  <Text style={styles.secondaryHeroButtonText}>Reports</Text>
                  {openCount > 0 ? (
                    <View style={styles.reportCountBadge}>
                      <Text style={styles.reportCountBadgeText}>{openCount}</Text>
                    </View>
                  ) : null}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  testID="content-manager-refresh"
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
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
              <TextInput
                value={filters.query}
                onChangeText={setQuery}
                placeholder="Search by title, doc id, course code, or session code"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.searchInput}
              />
            </View>

            <ContentManagerFilterPills
              label="Type"
              options={TYPE_OPTIONS}
              selectedId={filters.type}
              onChange={setType}
            />

            <ContentManagerFilterPills
              label="Access"
              options={ACCESS_OPTIONS}
              selectedId={filters.access}
              onChange={setAccess}
            />

            <ContentManagerFilterPills
              label="Thumbnail"
              options={THUMBNAIL_OPTIONS}
              selectedId={filters.thumbnail}
              onChange={setThumbnail}
            />

            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {!isLoading ? (
              <Text style={styles.resultsText}>
                {filteredItems.length} result{filteredItems.length === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.emptyTitle}>Loading content</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="documents-outline" size={40} color={theme.colors.textMuted} />
              <Text style={styles.emptyTitle}>No matching content</Text>
              <Text style={styles.emptyBody}>
                Try a different search term or relax one of the filters.
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
    heroActions: {
      gap: 10,
      alignItems: Platform.OS === 'web' ? 'flex-end' : 'stretch',
    },
    secondaryHeroButton: {
      minHeight: 42,
      borderRadius: theme.borderRadius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    secondaryHeroButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.text,
    },
    reportCountBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    reportCountBadgeText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 11,
      color: theme.colors.textOnPrimary,
    },
    reportsHint: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
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
