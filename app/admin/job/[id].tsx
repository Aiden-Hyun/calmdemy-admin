import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useJobDetailActions } from '@features/admin/hooks/useJobDetailActions';
import { JobDetailView } from '@features/admin/components/JobDetailView';
import { Theme } from '@/theme';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const state = useJobDetailActions(id);

  if (state.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!state.job) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>Job not found</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen options={{ title: 'Job Details' }} />
      <JobDetailView
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
      />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      backgroundColor: theme.colors.background,
    },
    emptyText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 18,
      color: theme.colors.text,
    },
  });
