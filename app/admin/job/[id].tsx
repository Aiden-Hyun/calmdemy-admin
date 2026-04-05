import React from 'react';
import { View, ActivityIndicator, Text, Alert, StyleSheet, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import {
  useActiveJobWorkers,
  useChildJobs,
  useJobDetail,
  useJobStepTimeline,
} from '@features/admin/hooks/useJobQueue';
import { publishCompletedJob } from '@features/admin/data/adminRepository';
import { JobDetailView } from '@features/admin/components/JobDetailView';
import { Theme } from '@/theme';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const {
    job,
    factoryJob,
    factoryRun,
    executionView,
    isLoading,
    retry,
    cancel,
    requestDelete,
    regenerateCourse,
    approveSubjectPlan,
    approvePendingScripts,
    pauseSubject,
    requestThumbnail,
    regenerateSubjectPlan,
    regeneratePendingScripts,
    resumeSubject,
  } = useJobDetail(id);
  const { jobs: childJobs, isLoading: isChildJobsLoading } = useChildJobs(
    job?.contentType === 'full_subject' ? id : undefined
  );
  const { workersByJobId } = useActiveJobWorkers(job ? [job.id] : []);
  const effectiveStatus = executionView?.effectiveStatus || job?.status;
  const effectiveRunId = executionView?.engineRunId || job?.v2RunId;
  const { timeline, isLoading: isTimelineLoading } = useJobStepTimeline(
    id || '',
    effectiveRunId
  );

  const handleRetry = () => retry();
  const handleCancel = () => cancel();
  const confirmAction = (message: string) => {
    if (Platform.OS !== 'web') {
      return Promise.resolve(true);
    }

    const webConfirm = (
      globalThis as typeof globalThis & { confirm?: (value?: string) => boolean }
    ).confirm;
    return Promise.resolve(typeof webConfirm === 'function' ? webConfirm(message) : true);
  };

  const startPublish = async () => {
    if (!job) {
      return;
    }

    await publishCompletedJob(job.id);
  };

  const handlePublish = async () => {
    if (!job) return;
    const isPublishingRegeneratedSessions =
      job.contentType === 'course' &&
      effectiveStatus === 'completed' &&
      Boolean(job.courseRegeneration?.active && job.courseRegeneration.requiresPublishApproval);
    const message = isPublishingRegeneratedSessions
      ? 'This will replace the selected live course sessions with regenerated audio. Continue?'
      : 'This will make the content visible to users. Continue?';

    if (Platform.OS === 'web') {
      const confirmed = await confirmAction(message);
      if (!confirmed) {
        return;
      }
      await startPublish();
      return;
    }

    Alert.alert(
      isPublishingRegeneratedSessions ? 'Publish Regenerated Sessions' : 'Publish Content',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: async () => {
            await startPublish();
          },
        },
      ]
    );
  };
  const handleDelete = async () => {
    if (!job) return;
    const message =
      job.contentType === 'full_subject'
        ? 'This will delete the full subject job and also request deletion for all non-completed child course jobs. Completed child jobs will be kept. Continue?'
        : 'This will delete the job and its generated artifacts. Continue?';

    if (Platform.OS === 'web') {
      const confirmed = await confirmAction(message);
      if (!confirmed) {
        return;
      }
      await requestDelete();
      return;
    }

    Alert.alert(
      job.contentType === 'full_subject' ? 'Delete Full Subject' : 'Delete Job',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await requestDelete();
          },
        },
      ]
    );
  };
  const startApprovePendingScripts = async (input?: {
    rawScriptEdits?: Record<string, string>;
    script?: string;
  }) => {
    await approvePendingScripts(input);
  };

  const startRegeneratePendingScripts = async () => {
    await regeneratePendingScripts();
  };
  const startApproveSubjectPlan = async (input?: {
    courseEdits?: Record<string, { title?: string; description?: string }>;
  }) => {
    await approveSubjectPlan(input);
  };
  const startRegenerateSubjectPlan = async () => {
    await regenerateSubjectPlan();
  };
  const startPauseSubject = async () => {
    await pauseSubject();
  };
  const startResumeSubject = async () => {
    await resumeSubject();
  };
  const startRequestThumbnail = async () => {
    await requestThumbnail();
  };

  const handleApprovePendingScripts = async (input?: {
    rawScriptEdits?: Record<string, string>;
    script?: string;
  }) => {
    if (!job) {
      return;
    }

    const isRegenerationApproval = Boolean(
      job.courseRegeneration?.active &&
        job.courseRegeneration.mode === 'script_and_audio' &&
        job.courseRegeneration.awaitingScriptApproval
    );
    const isSingleScriptApproval = Boolean(
      job.contentType !== 'course' &&
        job.scriptApproval?.enabled &&
        job.scriptApproval.awaitingApproval
    );
    const message = isRegenerationApproval
      ? 'This will confirm the regenerated scripts and continue with formatting and audio generation.'
      : isSingleScriptApproval
        ? 'This will confirm the script and continue with formatting, image generation, and audio generation.'
        : 'This will confirm the course scripts and continue with formatting and audio generation.';

    if (Platform.OS === 'web') {
      const confirmed = await confirmAction(message);
      if (!confirmed) {
        return;
      }

      await startApprovePendingScripts(input);
      return;
    }

    Alert.alert(
      isRegenerationApproval
        ? 'Approve Regenerated Scripts'
        : isSingleScriptApproval
          ? 'Approve Script'
          : 'Approve Course Scripts',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              await startApprovePendingScripts(input);
            } catch (error) {
              Alert.alert(
                'Approval Failed',
                error instanceof Error ? error.message : 'Unable to approve pending script.'
              );
            }
          },
        },
      ]
    );
  };

  const handleReview = () => {
    if (!job) return;
    router.push({ pathname: '/admin/job/[id]/review', params: { id: job.id } });
  };
  const handleApproveSubjectPlan = async (input?: {
    courseEdits?: Record<string, { title?: string; description?: string }>;
  }) => {
    if (!job) return;
    const message =
      'This will lock the lineup and start launching child course jobs for the approved full subject.';

    if (Platform.OS === 'web') {
      const confirmed = await confirmAction(message);
      if (!confirmed) {
        return;
      }
      await startApproveSubjectPlan(input);
      return;
    }

    Alert.alert('Approve Subject Lineup', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          await startApproveSubjectPlan(input);
        },
      },
    ]);
  };

  const handleRequestThumbnail = async () => {
    if (!job) return;
    const hasThumbnail = Boolean(job.thumbnailUrl);
    const message = hasThumbnail
      ? 'This will generate a new thumbnail for the completed course and refresh the published course if one already exists.'
      : 'This will generate a thumbnail for the completed course. If the course is already published, the published course will be updated too.';

    if (Platform.OS === 'web') {
      const confirmed = await confirmAction(message);
      if (!confirmed) {
        return;
      }
      await startRequestThumbnail();
      return;
    }

    Alert.alert(hasThumbnail ? 'Regenerate Thumbnail' : 'Generate Thumbnail', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: hasThumbnail ? 'Regenerate' : 'Generate',
        onPress: async () => {
          await startRequestThumbnail();
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>Job not found</Text>
      </View>
    );
  }

  const isCourseRegenAwaitingPublish =
    job.contentType === 'course' &&
    effectiveStatus === 'completed' &&
    Boolean(
      job.courseRegeneration?.active &&
        job.courseRegeneration.requiresPublishApproval &&
        !job.courseRegeneration.awaitingScriptApproval
    );
  const isCourseRegenAwaitingScriptApproval =
    job.contentType === 'course' &&
    effectiveStatus === 'completed' &&
    Boolean(
      job.courseRegeneration?.active &&
        job.courseRegeneration.mode === 'script_and_audio' &&
        job.courseRegeneration.awaitingScriptApproval
    );
  const isCourseInitialAwaitingScriptApproval =
    job.contentType === 'course' &&
    effectiveStatus === 'completed' &&
    Boolean(job.courseScriptApproval?.enabled && job.courseScriptApproval.awaitingApproval);
  const isSingleAwaitingScriptApproval =
    job.contentType !== 'course' &&
    job.contentType !== 'full_subject' &&
    effectiveStatus === 'completed' &&
    Boolean(job.scriptApproval?.enabled && job.scriptApproval.awaitingApproval);
  const isSubjectPlanAwaitingApproval =
    job.contentType === 'full_subject' &&
    effectiveStatus === 'completed' &&
    Boolean(job.subjectPlanApproval?.enabled && job.subjectPlanApproval.awaitingApproval);
  const isAwaitingAnyScriptApproval =
    isCourseRegenAwaitingScriptApproval ||
    isCourseInitialAwaitingScriptApproval ||
    isSingleAwaitingScriptApproval;
  const isAwaitingApproval =
    !isAwaitingAnyScriptApproval &&
    !isSubjectPlanAwaitingApproval &&
    (isCourseRegenAwaitingPublish ||
      (effectiveStatus === 'completed' && !job.autoPublish && !job.publishedContentId));
  const isReviewable =
    effectiveStatus === 'completed' &&
    !isAwaitingAnyScriptApproval &&
    (!job.autoPublish || isCourseRegenAwaitingPublish);
  const isDeletable =
    effectiveStatus === 'failed' || (effectiveStatus === 'completed' && !job.autoPublish);
  const publishButtonLabel = isCourseRegenAwaitingPublish
    ? 'Publish Regenerated Sessions'
    : 'Publish Now';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Stack.Screen
        options={{
          title: 'Job Details',
        }}
      />
      <JobDetailView
        job={job}
        factoryJob={factoryJob}
        factoryRun={factoryRun}
        executionView={executionView}
        activeWorkers={workersByJobId[job.id] || []}
        childJobs={childJobs}
        isChildJobsLoading={isChildJobsLoading}
        timeline={timeline}
        isTimelineLoading={isTimelineLoading}
        isAwaitingApproval={isAwaitingApproval}
        isAwaitingSubjectPlanApproval={isSubjectPlanAwaitingApproval}
        isReviewable={isReviewable}
        isDeletable={isDeletable}
        onApproveSubjectPlan={handleApproveSubjectPlan}
        onRetry={handleRetry}
        onCancel={handleCancel}
        onPublish={handlePublish}
        publishButtonLabel={publishButtonLabel}
        onPauseSubject={startPauseSubject}
        onRequestThumbnail={handleRequestThumbnail}
        onRegenerateCourse={regenerateCourse}
        onRegenerateSubjectPlan={startRegenerateSubjectPlan}
        onApprovePendingScripts={handleApprovePendingScripts}
        onRegeneratePendingScripts={startRegeneratePendingScripts}
        onResumeSubject={startResumeSubject}
        onDelete={handleDelete}
        onReview={handleReview}
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
