/**
 * Right-hand inspector pane showing selected job details.
 *
 * ARCHITECTURAL ROLE:
 * Displays full job detail view (narrower variant) in responsive right column.
 * Resolves all job metadata and actions via useJobDetailActions hook.
 *
 * DESIGN PATTERN:
 * - Facade pattern: useJobDetailActions hides complexity of job data resolution
 * - Responsive layout: layoutMode='inspector' constrains width for fixed pane
 * - Lazy loading: Only loads detail data when job is selected
 * - Empty state: Shows placeholder when no job selected
 *
 * CONTENT:
 * When no job selected: Shows help text "Select a job from the list..."
 * When job selected: Shows full JobDetailView with all metadata, timeline, actions
 * When loading: Shows activity indicator
 * When not found: Shows error state (job was deleted/unavailable)
 */

import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useJobDetailActions } from '../../hooks/useJobDetailActions';
import { JobDetailView } from '../JobDetailView';
import { Theme } from '@/theme';

export interface InspectorPaneProps {
  selectedJobId: string | null;
}

export function InspectorPane({ selectedJobId }: InspectorPaneProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!selectedJobId) {
    return (
      <View style={styles.pane}>
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={40} color={theme.colors.textMuted} />
          <Text style={styles.emptyTitle}>Select a job</Text>
          <Text style={styles.emptyText}>
            Pick any job from the list to inspect its pipeline, logs, and actions here.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pane}>
      <InspectorJobDetail jobId={selectedJobId} />
    </View>
  );
}

function InspectorJobDetail({ jobId }: { jobId: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const state = useJobDetailActions(jobId);

  if (state.isLoading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!state.job) {
    return (
      <View style={styles.empty}>
        <Ionicons name="alert-circle-outline" size={40} color={theme.colors.textMuted} />
        <Text style={styles.emptyTitle}>Job not found</Text>
      </View>
    );
  }

  return (
    <JobDetailView
      layoutMode="inspector"
      job={state.job}
      factoryJob={state.factoryJob}
      factoryRun={state.factoryRun}
      executionView={state.executionView}
      activeWorkers={state.activeWorkers}
      childJobs={state.childJobs}
      isChildJobsLoading={state.isChildJobsLoading}
      timeline={state.timeline}
      isTimelineLoading={state.isTimelineLoading}
      isAwaitingApproval={state.isAwaitingApproval}
      isAwaitingSubjectPlanApproval={state.isAwaitingSubjectPlanApproval}
      isReviewable={state.isReviewable}
      isDeletable={state.isDeletable}
      publishButtonLabel={state.publishButtonLabel}
      onApproveSubjectPlan={state.handleApproveSubjectPlan}
      onRetry={state.handleRetry}
      onCancel={state.handleCancel}
      onPublish={state.handlePublish}
      onPauseSubject={state.handlePauseSubject}
      onRequestThumbnail={state.handleRequestThumbnail}
      onRegenerateCourse={state.handleRegenerateCourse}
      onRegenerateSubjectPlan={state.handleRegenerateSubjectPlan}
      onApprovePendingScripts={state.handleApprovePendingScripts}
      onRegeneratePendingScripts={state.handleRegeneratePendingScripts}
      onResumeSubject={state.handleResumeSubject}
      onDelete={state.handleDelete}
      onReview={state.handleReview}
      onUpdateTitle={state.handleUpdateTitle}
      onRegenerateSingleScript={state.handleRegenerateSingleScript}
    />
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    pane: {
      width: 560,
      minWidth: 480,
      maxWidth: 720,
      flexGrow: 1.2,
      backgroundColor: theme.colors.background,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      gap: 12,
    },
    emptyTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 16,
      color: theme.colors.text,
    },
    emptyText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 13,
      color: theme.colors.textMuted,
      textAlign: 'center',
      maxWidth: 320,
      lineHeight: 18,
    },
  });
