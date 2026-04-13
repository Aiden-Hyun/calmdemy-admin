import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { JobStatus, JOB_STATUS_ORDER, JOB_STATUS_LABELS, JobStepTimelineEntry } from '../types';
import { Theme } from '@/theme';

// ---------------------------------------------------------------------------
// V2 pipeline checklist — derives step states from timeline entries
// ---------------------------------------------------------------------------

const V2_SINGLE_CONTENT_STEPS: { key: string; label: string }[] = [
  { key: 'generate_script', label: 'Generate Script' },
  { key: 'format_script', label: 'Format Script' },
  { key: 'generate_image', label: 'Generate Thumbnail' },
  { key: 'synthesize_audio', label: 'Synthesize Audio' },
  { key: 'post_process_audio', label: 'Post-Process Audio' },
  { key: 'upload_audio', label: 'Upload Audio' },
  { key: 'publish_content', label: 'Publish Content' },
];

// Chunk-based audio steps that map to the "Synthesize Audio" row.
const AUDIO_CHUNK_KEYS = new Set([
  'synthesize_audio_chunk',
  'assemble_audio',
]);

type StepState = 'done' | 'checkpoint' | 'running' | 'failed' | 'pending';

function deriveV2StepStates(
  timeline: JobStepTimelineEntry[],
  jobStatus: JobStatus,
): Map<string, StepState> {
  const states = new Map<string, StepState>();

  // For sharded steps (audio chunks), track per-shard states separately
  // so we only mark the parent step done when ALL shards have succeeded.
  const audioShardStates = new Map<string, string>(); // shardKey -> state

  for (const entry of timeline) {
    const isAudioChunk = AUDIO_CHUNK_KEYS.has(entry.stepName);
    const key = isAudioChunk ? 'synthesize_audio' : entry.stepName;
    const entryState = entry.state;

    if (isAudioChunk) {
      // Track each shard individually — use the most advanced state per shard.
      const shardId = `${entry.stepName}:${entry.shardKey || 'root'}`;
      const currentShard = audioShardStates.get(shardId);
      if (
        !currentShard ||
        entryState === 'succeeded' ||
        (entryState === 'running' && currentShard !== 'succeeded') ||
        (entryState === 'failed' && currentShard !== 'succeeded')
      ) {
        audioShardStates.set(shardId, entryState);
      }
      continue;
    }

    const current = states.get(key);

    if (entryState === 'succeeded') {
      const isCheckpoint = entry.workerId === 'checkpoint';
      if (current !== 'done') {
        states.set(key, isCheckpoint ? 'checkpoint' : 'done');
      }
    } else if (entryState === 'failed' && current !== 'done' && current !== 'checkpoint') {
      states.set(key, 'failed');
    } else if (
      (entryState === 'running' || entryState === 'leased' || entryState === 'ready') &&
      current !== 'done' &&
      current !== 'checkpoint' &&
      current !== 'failed'
    ) {
      states.set(key, 'running');
    }
  }

  // Resolve the audio shards into a single synthesize_audio state.
  if (audioShardStates.size > 0) {
    const shardValues = Array.from(audioShardStates.values());
    const allSucceeded = shardValues.every((s) => s === 'succeeded');
    const anyFailed = shardValues.some((s) => s === 'failed');
    const anyRunning = shardValues.some((s) => s === 'running' || s === 'leased');

    if (allSucceeded) {
      states.set('synthesize_audio', 'done');
    } else if (anyFailed) {
      states.set('synthesize_audio', 'failed');
    } else if (anyRunning) {
      states.set('synthesize_audio', 'running');
    } else {
      // Some ready, some succeeded — still in progress.
      states.set('synthesize_audio', 'running');
    }
  }

  // If job is completed, mark publish as done even if timeline is sparse.
  if (jobStatus === 'completed' && !states.has('publish_content')) {
    states.set('publish_content', 'done');
  }

  return states;
}

function V2PipelineChecklist({
  timeline,
  jobStatus,
}: {
  timeline: JobStepTimelineEntry[];
  jobStatus: JobStatus;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const stepStates = useMemo(() => deriveV2StepStates(timeline, jobStatus), [timeline, jobStatus]);

  return (
    <View style={styles.container}>
      {V2_SINGLE_CONTENT_STEPS.map(({ key, label }) => {
        const state: StepState = stepStates.get(key) || 'pending';

        let iconName: keyof typeof Ionicons.glyphMap;
        let iconColor: string;
        let labelStyle: any[];

        switch (state) {
          case 'done':
            iconName = 'checkmark-circle';
            iconColor = theme.colors.success;
            labelStyle = [styles.stepLabel, styles.doneLabel];
            break;
          case 'checkpoint':
            iconName = 'checkmark-circle-outline';
            iconColor = theme.colors.success;
            labelStyle = [styles.stepLabel, styles.checkpointLabel];
            break;
          case 'running':
            iconName = 'radio-button-on';
            iconColor = theme.colors.primary;
            labelStyle = [styles.stepLabel, styles.activeLabel];
            break;
          case 'failed':
            iconName = 'close-circle';
            iconColor = theme.colors.error;
            labelStyle = [styles.stepLabel, styles.failedLabel];
            break;
          default:
            iconName = 'ellipse-outline';
            iconColor = theme.colors.gray[400];
            labelStyle = [styles.stepLabel];
        }

        return (
          <View key={key} style={styles.step}>
            <Ionicons name={iconName} size={20} color={iconColor} />
            <Text style={labelStyle}>{label}</Text>
            {state === 'checkpoint' && (
              <Text style={[styles.badge, { color: theme.colors.textMuted }]}>reused</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Legacy pipeline stepper — status-based (fallback when no V2 timeline)
// ---------------------------------------------------------------------------

const PIPELINE_STEPS = JOB_STATUS_ORDER.filter(
  (s) => s !== 'pending' && s !== 'completed' && s !== 'paused'
);

function LegacyPipelineStepper({ currentStatus }: { currentStatus: JobStatus }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const displayStatus = currentStatus === 'paused' ? 'llm_generating' : currentStatus;
  const currentIndex = JOB_STATUS_ORDER.indexOf(displayStatus);
  const isFailed = currentStatus === 'failed';
  const isCompleted = currentStatus === 'completed';

  return (
    <View style={styles.container}>
      {PIPELINE_STEPS.map((step) => {
        const stepIndex = JOB_STATUS_ORDER.indexOf(step);
        const isActive = step === displayStatus;
        const isDone = !isFailed && currentIndex > stepIndex;

        let iconName: keyof typeof Ionicons.glyphMap = 'ellipse-outline';
        let iconColor = theme.colors.gray[400];

        if (isDone || isCompleted) {
          iconName = 'checkmark-circle';
          iconColor = theme.colors.success;
        } else if (isActive && !isFailed) {
          iconName = 'radio-button-on';
          iconColor = theme.colors.primary;
        } else if (isActive && isFailed) {
          iconName = 'close-circle';
          iconColor = theme.colors.error;
        }

        return (
          <View key={step} style={styles.step}>
            <Ionicons name={iconName} size={20} color={iconColor} />
            <Text
              style={[
                styles.stepLabel,
                isActive && !isFailed && styles.activeLabel,
                isDone && styles.doneLabel,
                isActive && isFailed && styles.failedLabel,
              ]}
            >
              {JOB_STATUS_LABELS[step]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Public export — picks V2 checklist when timeline is available
// ---------------------------------------------------------------------------

interface PipelineStepperProps {
  currentStatus: JobStatus;
  timeline?: JobStepTimelineEntry[];
}

export function PipelineStepper({ currentStatus, timeline }: PipelineStepperProps) {
  if (timeline && timeline.length > 0) {
    return <V2PipelineChecklist timeline={timeline} jobStatus={currentStatus} />;
  }
  return <LegacyPipelineStepper currentStatus={currentStatus} />;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: 12,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    stepLabel: {
      fontFamily: 'DMSans-Regular',
      fontSize: 14,
      color: theme.colors.gray[400],
    },
    activeLabel: {
      fontFamily: 'DMSans-SemiBold',
      color: theme.colors.primary,
    },
    doneLabel: {
      color: theme.colors.success,
    },
    checkpointLabel: {
      color: theme.colors.success,
      fontStyle: 'italic',
    },
    failedLabel: {
      fontFamily: 'DMSans-SemiBold',
      color: theme.colors.error,
    },
    badge: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      fontStyle: 'italic',
    },
  });
