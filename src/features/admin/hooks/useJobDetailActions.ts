/**
 * Unified hook for job detail data + actions (Facade pattern).
 *
 * ARCHITECTURAL ROLE:
 * Aggregates job data (content_job, factory_job, factory_run, timeline, workers)
 * and job actions (publish, delete, approve, regenerate) into single interface.
 * Used by both full-screen job route (/admin/job/[id]) and shell inspector pane.
 *
 * DESIGN PATTERNS:
 * - Facade: Hide useJobDetail, useChildJobs, useJobStepTimeline, useActiveJobWorkers complexity
 * - Master-Detail: Single job ID -> load all related nested resources
 * - Command pattern: Each handler (handleRetry, handlePublish, etc.) encapsulates action
 * - Derived state: Boolean flags (isAwaitingApproval, isDeletable) computed from job state
 * - Platform abstraction: Alert (native) vs confirm dialog (web); respect Platform.OS
 *
 * DATA AGGREGATION:
 * 1. useJobDetail: ContentJob + FactoryJob + FactoryJobRun + executionView
 * 2. useChildJobs: For full_subject jobs, track child course jobs
 * 3. useJobStepTimeline: V2 factory step execution timeline
 * 4. useActiveJobWorkers: Workers currently executing this job
 *
 * APPROVAL WORKFLOWS:
 * Complex multi-step state machines:
 * - Script approval: completed -> pending approval -> approved -> TTS
 * - Subject plan: full_subject completed -> plan approval -> launch children
 * - Course regen: completed -> regen -> optional script approval -> publish approval
 *
 * CONFIRMATION DIALOGS:
 * Platform-specific: web uses confirm(), mobile skips confirmation (async Alert is awkward).
 * Shows warnings for destructive actions (publish regen, delete subject with children).
 */

import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useActiveJobWorkers,
  useChildJobs,
  useJobDetail,
  useJobStepTimeline,
} from './useJobQueue';
import { publishCompletedJob } from '../data/adminRepository';
import { CourseRegenerationMode } from '../types';

/**
 * Cross-platform confirmation dialog.
 * Web uses native confirm(); mobile skips confirmation (Alert.alert is async).
 */
function confirmAction(message: string): Promise<boolean> {
  if (Platform.OS !== 'web') {
    return Promise.resolve(true);
  }
  const webConfirm = (
    globalThis as typeof globalThis & { confirm?: (value?: string) => boolean }
  ).confirm;
  return Promise.resolve(typeof webConfirm === 'function' ? webConfirm(message) : true);
}

/**
 * Unified job-detail data + actions hook for both full-screen and inspector views.
 *
 * Encapsulates all wiring to avoid duplication. Both the full-screen job route
 * and the shell's right-pane inspector spread this hook's result into JobDetailView.
 * This is a Facade pattern: users see a single interface; internals coordinate N subscriptions.
 */
export function useJobDetailActions(jobId: string | undefined) {
  const router = useRouter();

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
  } = useJobDetail(jobId || '');

  const { jobs: childJobs, isLoading: isChildJobsLoading } = useChildJobs(
    job?.contentType === 'full_subject' ? jobId : undefined
  );
  const { workersByJobId } = useActiveJobWorkers(job ? [job.id] : []);
  const effectiveStatus = executionView?.effectiveStatus || job?.status;
  const effectiveRunId = executionView?.engineRunId || job?.v2RunId;
  const { timeline, isLoading: isTimelineLoading } = useJobStepTimeline(
    jobId || '',
    effectiveRunId
  );

/** Command: Retry execution from last checkpoint. */
  const handleRetry = useCallback(() => {
    retry();
  }, [retry]);

  /** Command: Cancel in-progress job. */
  const handleCancel = useCallback(() => {
    cancel();
  }, [cancel]);

/**
   * Command: Publish completed job.
   * For courses with regeneration, warns that live sessions will be replaced.
   * Uses platform-appropriate confirmation dialogs.
   */
  const handlePublish = useCallback(async () => {
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
      if (!confirmed) return;
      await publishCompletedJob(job.id);
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
            await publishCompletedJob(job.id);
          },
        },
      ]
    );
  }, [job, effectiveStatus]);

  const handleDelete = useCallback(async () => {
    if (!job) return;
    const message =
      job.contentType === 'full_subject'
        ? 'This will delete the full subject job and also request deletion for all non-completed child course jobs. Completed child jobs will be kept. Continue?'
        : 'This will delete the job and its generated artifacts. Continue?';

    if (Platform.OS === 'web') {
      const confirmed = await confirmAction(message);
      if (!confirmed) return;
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
  }, [job, requestDelete]);

  const handleApprovePendingScripts = useCallback(
    async (input?: { rawScriptEdits?: Record<string, string>; script?: string }) => {
      if (!job) return;

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
        if (!confirmed) return;
        await approvePendingScripts(input);
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
                await approvePendingScripts(input);
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
    },
    [job, approvePendingScripts]
  );

  const handleApproveSubjectPlan = useCallback(
    async (input?: {
      courseEdits?: Record<string, { title?: string; description?: string }>;
    }) => {
      if (!job) return;
      const message =
        'This will lock the lineup and start launching child course jobs for the approved full subject.';

      if (Platform.OS === 'web') {
        const confirmed = await confirmAction(message);
        if (!confirmed) return;
        await approveSubjectPlan(input);
        return;
      }

      Alert.alert('Approve Subject Lineup', message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            await approveSubjectPlan(input);
          },
        },
      ]);
    },
    [job, approveSubjectPlan]
  );

  const handleRequestThumbnail = useCallback(async () => {
    if (!job) return;
    const hasThumbnail = Boolean(job.thumbnailUrl);
    const message = hasThumbnail
      ? 'This will generate a new thumbnail for the completed course and refresh the published course if one already exists.'
      : 'This will generate a thumbnail for the completed course. If the course is already published, the published course will be updated too.';

    if (Platform.OS === 'web') {
      const confirmed = await confirmAction(message);
      if (!confirmed) return;
      await requestThumbnail();
      return;
    }

    Alert.alert(hasThumbnail ? 'Regenerate Thumbnail' : 'Generate Thumbnail', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: hasThumbnail ? 'Regenerate' : 'Generate',
        onPress: async () => {
          await requestThumbnail();
        },
      },
    ]);
  }, [job, requestThumbnail]);

  const handleRegenerateCourse = useCallback(
    async (input: {
      mode: CourseRegenerationMode;
      targetSessionCodes: string[];
      formattedScriptEdits?: Record<string, string>;
    }) => {
      await regenerateCourse(input);
    },
    [regenerateCourse]
  );

  const handleRegenerateSubjectPlan = useCallback(async () => {
    await regenerateSubjectPlan();
  }, [regenerateSubjectPlan]);

  const handleRegeneratePendingScripts = useCallback(async () => {
    await regeneratePendingScripts();
  }, [regeneratePendingScripts]);

  const handlePauseSubject = useCallback(async () => {
    await pauseSubject();
  }, [pauseSubject]);

  const handleResumeSubject = useCallback(async () => {
    await resumeSubject();
  }, [resumeSubject]);

  const handleReview = useCallback(() => {
    if (!job) return;
    router.push({ pathname: '/admin/job/[id]/review', params: { id: job.id } });
  }, [job, router]);

  // Derived flags (same logic as app/admin/job/[id].tsx).
  const isCourseRegenAwaitingPublish =
    job?.contentType === 'course' &&
    effectiveStatus === 'completed' &&
    Boolean(
      job?.courseRegeneration?.active &&
        job?.courseRegeneration.requiresPublishApproval &&
        !job?.courseRegeneration.awaitingScriptApproval
    );
  const isCourseRegenAwaitingScriptApproval =
    job?.contentType === 'course' &&
    effectiveStatus === 'completed' &&
    Boolean(
      job?.courseRegeneration?.active &&
        job?.courseRegeneration.mode === 'script_and_audio' &&
        job?.courseRegeneration.awaitingScriptApproval
    );
  const isCourseInitialAwaitingScriptApproval =
    job?.contentType === 'course' &&
    effectiveStatus === 'completed' &&
    Boolean(job?.courseScriptApproval?.enabled && job?.courseScriptApproval.awaitingApproval);
  const isSingleAwaitingScriptApproval =
    job?.contentType !== 'course' &&
    job?.contentType !== 'full_subject' &&
    effectiveStatus === 'completed' &&
    Boolean(job?.scriptApproval?.enabled && job?.scriptApproval.awaitingApproval);
  const isSubjectPlanAwaitingApproval =
    job?.contentType === 'full_subject' &&
    effectiveStatus === 'completed' &&
    Boolean(job?.subjectPlanApproval?.enabled && job?.subjectPlanApproval.awaitingApproval);
  const isAwaitingAnyScriptApproval =
    isCourseRegenAwaitingScriptApproval ||
    isCourseInitialAwaitingScriptApproval ||
    isSingleAwaitingScriptApproval;
  const isAwaitingApproval =
    !isAwaitingAnyScriptApproval &&
    !isSubjectPlanAwaitingApproval &&
    (isCourseRegenAwaitingPublish ||
      (effectiveStatus === 'completed' && !job?.autoPublish && !job?.publishedContentId));
  const isReviewable =
    effectiveStatus === 'completed' &&
    !isAwaitingAnyScriptApproval &&
    (!job?.autoPublish || isCourseRegenAwaitingPublish);
  const isDeletable =
    effectiveStatus === 'failed' || (effectiveStatus === 'completed' && !job?.autoPublish);
  const publishButtonLabel = isCourseRegenAwaitingPublish
    ? 'Publish Regenerated Sessions'
    : 'Publish Now';

  return {
    // data
    job,
    factoryJob,
    factoryRun,
    executionView,
    isLoading,
    childJobs,
    isChildJobsLoading,
    timeline,
    isTimelineLoading,
    activeWorkers: job ? workersByJobId[job.id] || [] : [],
    // derived flags
    isAwaitingApproval: Boolean(isAwaitingApproval),
    isAwaitingSubjectPlanApproval: Boolean(isSubjectPlanAwaitingApproval),
    isReviewable: Boolean(isReviewable),
    isDeletable: Boolean(isDeletable),
    publishButtonLabel,
    // handlers
    handleRetry,
    handleCancel,
    handlePublish,
    handleDelete,
    handleApprovePendingScripts,
    handleApproveSubjectPlan,
    handleRequestThumbnail,
    handleRegenerateCourse,
    handleRegenerateSubjectPlan,
    handleRegeneratePendingScripts,
    handlePauseSubject,
    handleResumeSubject,
    handleReview,
  };
}
