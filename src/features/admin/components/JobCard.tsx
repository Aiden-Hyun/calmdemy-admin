import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, GestureResponderEvent, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import {
  ActiveJobWorker,
  ContentJob,
  CONTENT_TYPE_LABELS,
  FactoryJob,
  FactoryJobRun,
  JOB_STATUS_LABELS,
  JobStatus,
} from '../types';
import { formatCourseCode } from '@shared/utils/courseCodeParser';
import { Theme } from '@/theme';
import { subscribeToFactoryJob, subscribeToFactoryJobRun } from '../data/adminRepository';
import { resolveJobExecutionView } from '../utils/jobExecutionState';

interface JobCardProps {
  job: ContentJob;
  activeWorkers?: ActiveJobWorker[];
  onPress: () => void;
  onPublish?: (job: ContentJob) => void;
  onGenerateThumbnail?: (job: ContentJob) => void;
}

interface PublishBadgeConfig {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  backgroundColor: string;
  borderColor: string;
}

function getStatusColor(status: string, theme: Theme): string {
  switch (status) {
    case 'completed':
      return theme.colors.success;
    case 'failed':
      return theme.colors.error;
    case 'paused':
      return theme.colors.warning;
    case 'pending':
      return theme.colors.gray[400];
    default:
      return theme.colors.info;
  }
}

function getStatusIcon(status: string): keyof typeof Ionicons.glyphMap {
  switch (status) {
    case 'completed':
      return 'checkmark-circle';
    case 'failed':
      return 'close-circle';
    case 'paused':
      return 'pause-circle';
    case 'pending':
      return 'time-outline';
    default:
      return 'sync-outline';
  }
}

function useJobCardExecutionView(job: ContentJob) {
  const [factoryJob, setFactoryJob] = useState<FactoryJob | null>(null);
  const [factoryRun, setFactoryRun] = useState<FactoryJobRun | null>(null);

  const factoryJobId = useMemo(() => {
    if (job.engine === 'v2') {
      return String(job.v2JobId || job.id || '').trim() || undefined;
    }
    return job.v2JobId ? String(job.v2JobId).trim() || undefined : undefined;
  }, [job.engine, job.id, job.v2JobId]);

  useEffect(() => {
    if (!factoryJobId) {
      setFactoryJob(null);
      return;
    }
    return subscribeToFactoryJob(factoryJobId, setFactoryJob);
  }, [factoryJobId]);

  const factoryRunId = useMemo(
    () => String(factoryJob?.currentRunId || job.v2RunId || '').trim() || undefined,
    [factoryJob?.currentRunId, job.v2RunId]
  );

  useEffect(() => {
    if (!factoryRunId) {
      setFactoryRun(null);
      return;
    }
    return subscribeToFactoryJobRun(factoryRunId, setFactoryRun);
  }, [factoryRunId]);

  return useMemo(
    () => resolveJobExecutionView(job, factoryJob, factoryRun),
    [job, factoryJob, factoryRun]
  );
}

export function JobCard({
  job,
  activeWorkers = [],
  onPress,
  onPublish,
  onGenerateThumbnail,
}: JobCardProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const executionView = useJobCardExecutionView(job);
  const effectiveStatus: JobStatus = executionView?.effectiveStatus || job.status;
  const statusColor = getStatusColor(effectiveStatus, theme);
  const headline = useMemo(() => getJobHeadline(job), [job]);
  const visibleWorkerIds = useMemo(
    () => getVisibleActiveWorkerIds(activeWorkers),
    [activeWorkers]
  );
  const timingLabel = useMemo(() => getTimingLabel(job, effectiveStatus), [job, effectiveStatus]);
  const ttsProgressLabel = useMemo(() => getTtsProgressLabel(job, effectiveStatus), [job, effectiveStatus]);
  const publishBadge = useMemo(
    () => getPublishBadge(job, theme, effectiveStatus),
    [job, theme, effectiveStatus]
  );
  const canPublishFromCard = useMemo(
    () => canPublishFromFactoryCard(job, effectiveStatus),
    [job, effectiveStatus]
  );
  const thumbnailBadge = useMemo(
    () => getThumbnailBadge(job, theme, effectiveStatus),
    [job, theme, effectiveStatus]
  );
  const canGenerateThumbnailFromCard = useMemo(
    () => canGenerateThumbnailFromCardList(job, effectiveStatus),
    [job, effectiveStatus]
  );
  const displayError = effectiveStatus === 'failed' ? job.error : undefined;
  const thumbnailUrl = useMemo(() => String(job.thumbnailUrl || '').trim(), [job.thumbnailUrl]);

  const timeAgo = useMemo(() => {
    if (!job.createdAt?.toDate) return '';
    const diff = Date.now() - job.createdAt.toDate().getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, [job.createdAt]);

  const handlePublishPress = (event: GestureResponderEvent) => {
    event.stopPropagation?.();
    if (!canPublishFromCard || !onPublish) {
      return;
    }
    onPublish(job);
  };

  const handleGenerateThumbnailPress = (event: GestureResponderEvent) => {
    event.stopPropagation?.();
    if (!canGenerateThumbnailFromCard || !onGenerateThumbnail) {
      return;
    }
    onGenerateThumbnail(job);
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.header}>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
          <Ionicons name={getStatusIcon(effectiveStatus)} size={14} color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {JOB_STATUS_LABELS[effectiveStatus]}
          </Text>
        </View>
        <Text style={styles.timeText}>{timeAgo}</Text>
      </View>

      <Text style={styles.topic} numberOfLines={2}>
        {headline}
      </Text>

      <View style={styles.meta}>
        <Text style={styles.metaText}>
          {CONTENT_TYPE_LABELS[job.contentType]}
        </Text>
        {job.contentType !== 'full_subject' && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>
              {job.params.duration_minutes} min
            </Text>
          </>
        )}
        {job.contentType === 'full_subject' && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>
              {job.params.courseCount || 0} courses
            </Text>
          </>
        )}
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{job.llmModel}</Text>
      </View>

      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={styles.thumbnailPreview}
          resizeMode="cover"
        />
      ) : null}

      {publishBadge ? (
        <Pressable
          style={({ pressed }) => [
            styles.publishBadge,
            {
              backgroundColor: publishBadge.backgroundColor,
              borderColor: publishBadge.borderColor,
            },
            canPublishFromCard && styles.publishBadgeAction,
            pressed && canPublishFromCard && styles.publishBadgePressed,
          ]}
          disabled={!canPublishFromCard || !onPublish}
          onPress={handlePublishPress}
        >
          <Ionicons
            name={publishBadge.icon}
            size={14}
            color={publishBadge.color}
          />
          <Text style={[styles.publishBadgeText, { color: publishBadge.color }]}>
            {canPublishFromCard ? `${publishBadge.label} • Publish` : publishBadge.label}
          </Text>
        </Pressable>
      ) : null}

      {thumbnailBadge ? (
        <Pressable
          style={({ pressed }) => [
            styles.thumbnailBadge,
            {
              backgroundColor: thumbnailBadge.backgroundColor,
              borderColor: thumbnailBadge.borderColor,
            },
            canGenerateThumbnailFromCard && styles.thumbnailBadgeAction,
            pressed && canGenerateThumbnailFromCard && styles.thumbnailBadgePressed,
          ]}
          disabled={!canGenerateThumbnailFromCard || !onGenerateThumbnail}
          onPress={handleGenerateThumbnailPress}
        >
          <Ionicons
            name={thumbnailBadge.icon}
            size={14}
            color={thumbnailBadge.color}
          />
          <Text style={[styles.thumbnailBadgeText, { color: thumbnailBadge.color }]}>
            {thumbnailBadge.label}
          </Text>
        </Pressable>
      ) : null}

      {ttsProgressLabel ? (
        <View style={styles.ttsProgressBadge}>
          <Ionicons
            name="volume-high-outline"
            size={14}
            color={theme.colors.info}
          />
          <Text style={styles.ttsProgressBadgeText}>{ttsProgressLabel}</Text>
        </View>
      ) : null}

      {timingLabel ? (
        <View
          style={[
            styles.timingBadge,
            {
              backgroundColor: `${statusColor}12`,
              borderColor: `${statusColor}28`,
            },
          ]}
        >
          <Ionicons
            name="stopwatch-outline"
            size={14}
            color={statusColor}
          />
          <Text style={[styles.timingBadgeText, { color: statusColor }]}>{timingLabel}</Text>
        </View>
      ) : null}

      {visibleWorkerIds.length > 0 ? (
        <View style={styles.workerPanel}>
          <View style={styles.workerHeader}>
            <Ionicons
              name="hardware-chip-outline"
              size={14}
              color={theme.colors.primary}
            />
            <Text style={styles.workerLabel}>Workers</Text>
          </View>
          <View style={styles.workerList}>
            {visibleWorkerIds.map((workerId) => (
              <View key={workerId} style={styles.workerChip}>
                <Text style={styles.workerChipText}>{workerId}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {displayError && (
        <Text style={styles.errorText} numberOfLines={1}>
          {displayError}
        </Text>
      )}
    </Pressable>
  );
}

function getJobHeadline(job: ContentJob): string {
  if (job.contentType === 'full_subject') {
    const subjectLabel = String(job.params.subjectLabel || job.params.subjectId || '').trim();
    const totalCourses = Number(job.params.courseCount || 0);
    if (subjectLabel && totalCourses > 0) {
      return `${subjectLabel} Full Subject — ${totalCourses} courses`;
    }
    if (subjectLabel) {
      return `${subjectLabel} Full Subject`;
    }
  }

  if (job.contentType === 'course') {
    const courseCode = formatCourseCode(String(job.params.courseCode || '').trim());
    const courseTitle = String(job.params.courseTitle || '').trim();

    if (courseCode && courseTitle) {
      return `${courseCode} — ${courseTitle}`;
    }

    if (courseTitle) {
      return courseTitle;
    }

    if (courseCode) {
      return courseCode;
    }
  }

  return String(job.params.topic || '').trim();
}

function getVisibleActiveWorkerIds(activeWorkers: ActiveJobWorker[]): string[] {
  return Array.from(
    new Set(
      activeWorkers
        .map((worker) => String(worker.stackId || '').trim())
        .filter(Boolean)
    )
  );
}

function getTimingLabel(job: ContentJob, status: JobStatus): string | null {
  if (status !== 'completed' && status !== 'failed') {
    const liveElapsedMs =
      typeof job.activeRunElapsedMs === 'number' && Number.isFinite(job.activeRunElapsedMs)
        ? job.activeRunElapsedMs
        : 0;
    if (liveElapsedMs <= 0) {
      return null;
    }
    return `${formatElapsedMsRoundedToMinute(liveElapsedMs)} active`;
  }
  if (job.timingStatus !== 'exact') {
    return null;
  }
  const elapsedMs =
    typeof job.effectiveElapsedMs === 'number' && Number.isFinite(job.effectiveElapsedMs)
      ? job.effectiveElapsedMs
      : 0;
  if (elapsedMs <= 0) {
    return null;
  }
  return `${formatElapsedMsCompact(elapsedMs)} active`;
}

function getTtsProgressLabel(job: ContentJob, status: JobStatus): string | null {
  if (status !== 'tts_converting' || job.contentType !== 'course') {
    return null;
  }

  const totalChunks =
    typeof job.ttsProgress?.totalChunks === 'number' && Number.isFinite(job.ttsProgress.totalChunks)
      ? job.ttsProgress.totalChunks
      : 0;
  const completedChunks =
    typeof job.ttsProgress?.completedChunks === 'number' &&
    Number.isFinite(job.ttsProgress.completedChunks)
      ? Math.max(0, Math.min(totalChunks, job.ttsProgress.completedChunks))
      : 0;

  if (totalChunks > 0) {
    const percent =
      typeof job.ttsProgress?.percent === 'number' && Number.isFinite(job.ttsProgress.percent)
        ? Math.max(0, Math.min(100, Math.round(job.ttsProgress.percent)))
        : Math.round((completedChunks / totalChunks) * 100);
    return `TTS ${percent}% | ${completedChunks}/${totalChunks} chunks`;
  }

  const sessionCounts = getCourseAudioSessionCounts(job);
  if (!sessionCounts) {
    return null;
  }

  const sessionPercent = Math.round((sessionCounts.completed / sessionCounts.total) * 100);
  return `TTS ${sessionPercent}% | ${sessionCounts.completed}/${sessionCounts.total} audio`;
}

function getCourseAudioSessionCounts(job: ContentJob): { completed: number; total: number } | null {
  const progressMatch = String(job.courseProgress || '').match(/Audio\s+(\d+)\/(\d+)/i);
  if (progressMatch) {
    const completed = Number(progressMatch[1]);
    const total = Number(progressMatch[2]);
    if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
      return {
        completed: Math.max(0, Math.min(total, Math.round(completed))),
        total: Math.max(1, Math.round(total)),
      };
    }
  }

  const audioResults = job.courseAudioResults || {};
  const completed = Object.values(audioResults).filter((result) => {
    if (!result || typeof result !== 'object') {
      return false;
    }
    return Boolean(String(result.storagePath || '').trim());
  }).length;

  if (completed <= 0) {
    return { completed: 0, total: 9 };
  }

  return {
    completed,
    total: 9,
  };
}

function getPublishBadge(job: ContentJob, theme: Theme, status: JobStatus): PublishBadgeConfig | null {
  if (status !== 'completed' || job.contentType === 'full_subject') {
    return null;
  }

  if (job.contentType === 'course') {
    const isPublished = Boolean(String(job.courseId || '').trim());
    const previewCount = (job.coursePreviewSessions || []).length;
    const hasPendingUpdate = previewCount > 0;

    if (!isPublished && !hasPendingUpdate) {
      return null;
    }

    if (hasPendingUpdate && isPublished) {
      return {
        label: 'Update Pending',
        icon: 'time-outline',
        color: theme.colors.warning,
        backgroundColor: `${theme.colors.warning}12`,
        borderColor: `${theme.colors.warning}28`,
      };
    }

    if (isPublished) {
      return {
        label: 'Published',
        icon: 'checkmark-circle-outline',
        color: theme.colors.success,
        backgroundColor: `${theme.colors.success}12`,
        borderColor: `${theme.colors.success}28`,
      };
    }

    return {
      label: 'Not Published',
      icon: 'cloud-upload-outline',
      color: theme.colors.gray[600],
      backgroundColor: `${theme.colors.gray[500]}12`,
      borderColor: `${theme.colors.gray[500]}28`,
    };
  }

  const isPublished = Boolean(String(job.publishedContentId || '').trim());
  const hasPublishableOutput = isPublished || Boolean(String(job.audioPath || '').trim());
  if (!hasPublishableOutput) {
    return null;
  }
  if (isPublished) {
    return {
      label: 'Published',
      icon: 'checkmark-circle-outline',
      color: theme.colors.success,
      backgroundColor: `${theme.colors.success}12`,
      borderColor: `${theme.colors.success}28`,
    };
  }

  return {
    label: 'Not Published',
    icon: 'cloud-upload-outline',
    color: theme.colors.gray[600],
    backgroundColor: `${theme.colors.gray[500]}12`,
    borderColor: `${theme.colors.gray[500]}28`,
  };
}

function getThumbnailBadge(job: ContentJob, theme: Theme, status: JobStatus): PublishBadgeConfig | null {
  if (job.contentType !== 'course' || status !== 'completed') {
    return null;
  }

  if (String(job.thumbnailUrl || '').trim()) {
    return {
      label: 'Thumbnail Complete',
      icon: 'checkmark-circle-outline',
      color: theme.colors.success,
      backgroundColor: `${theme.colors.success}12`,
      borderColor: `${theme.colors.success}28`,
    };
  }

  return {
    label: 'Generate Thumbnail',
    icon: 'image-outline',
    color: theme.colors.secondary,
    backgroundColor: `${theme.colors.secondary}12`,
    borderColor: `${theme.colors.secondary}28`,
  };
}

function canPublishFromFactoryCard(job: ContentJob, status: JobStatus): boolean {
  if (status !== 'completed' || job.contentType === 'full_subject') {
    return false;
  }

  const isCourseRegenAwaitingScriptApproval = Boolean(
    job.contentType === 'course' &&
      job.courseRegeneration?.active &&
      job.courseRegeneration.mode === 'script_and_audio' &&
      job.courseRegeneration.awaitingScriptApproval
  );
  const isCourseInitialAwaitingScriptApproval = Boolean(
    job.contentType === 'course' &&
      job.courseScriptApproval?.enabled &&
      job.courseScriptApproval.awaitingApproval
  );
  const isSingleAwaitingScriptApproval = Boolean(
    job.contentType !== 'course' &&
      job.scriptApproval?.enabled &&
      job.scriptApproval.awaitingApproval
  );

  if (
    isCourseRegenAwaitingScriptApproval ||
    isCourseInitialAwaitingScriptApproval ||
    isSingleAwaitingScriptApproval
  ) {
    return false;
  }

  const isCourseRegenAwaitingPublish = Boolean(
    job.contentType === 'course' &&
      job.courseRegeneration?.active &&
      job.courseRegeneration.requiresPublishApproval
  );
  if (isCourseRegenAwaitingPublish) {
    return false;
  }

  if (job.contentType === 'course') {
    return !String(job.courseId || '').trim() && Boolean((job.coursePreviewSessions || []).length > 0);
  }

  return !String(job.publishedContentId || '').trim() && Boolean(String(job.audioPath || '').trim());
}

function canGenerateThumbnailFromCardList(job: ContentJob, status: JobStatus): boolean {
  const awaitingScriptApproval = Boolean(
    (job.courseRegeneration?.active &&
      job.courseRegeneration.mode === 'script_and_audio' &&
      job.courseRegeneration.awaitingScriptApproval) ||
      (job.courseScriptApproval?.enabled && job.courseScriptApproval.awaitingApproval)
  );

  return (
    job.contentType === 'course' &&
    status === 'completed' &&
    !awaitingScriptApproval &&
    !String(job.thumbnailUrl || '').trim()
  );
}

function formatElapsedMsRoundedToMinute(ms: number): string {
  const roundedMinutes = Math.max(1, Math.round(Math.max(0, ms) / 60000));
  if (roundedMinutes < 60) {
    return `${roundedMinutes}m`;
  }
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function formatElapsedMsCompact(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 16,
      ...theme.shadows.sm,
    },
    pressed: {
      opacity: 0.85,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    statusText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
    },
    timeText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    topic: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: 8,
    },
    meta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    thumbnailPreview: {
      width: 88,
      height: 88,
      marginTop: 12,
      alignSelf: 'flex-start',
      borderRadius: 12,
      backgroundColor: theme.colors.gray[100],
    },
    publishBadge: {
      marginTop: 10,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
    },
    publishBadgeAction: {
      shadowColor: theme.colors.primary,
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
      elevation: 1,
    },
    publishBadgePressed: {
      opacity: 0.85,
    },
    publishBadgeText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
    },
    thumbnailBadge: {
      marginTop: 10,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
    },
    thumbnailBadgeAction: {
      shadowColor: theme.colors.secondary,
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
      elevation: 1,
    },
    thumbnailBadgePressed: {
      opacity: 0.85,
    },
    thumbnailBadgeText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
    },
    workerPanel: {
      marginTop: 10,
    },
    timingBadge: {
      marginTop: 10,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
    },
    timingBadgeText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
    },
    ttsProgressBadge: {
      marginTop: 10,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: `${theme.colors.info}12`,
      borderWidth: 1,
      borderColor: `${theme.colors.info}28`,
    },
    ttsProgressBadgeText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
      color: theme.colors.info,
    },
    workerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    metaText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    workerLabel: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
      color: theme.colors.text,
    },
    workerList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    workerChip: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: theme.colors.gray[100],
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
    },
    workerChipText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
      color: theme.colors.text,
    },
    metaDot: {
      color: theme.colors.textMuted,
      fontSize: 13,
    },
    errorText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.error,
      marginTop: 8,
    },
  });
