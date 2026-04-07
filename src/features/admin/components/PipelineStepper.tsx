/**
 * Linear pipeline stepper visualization for job execution progress.
 *
 * ARCHITECTURAL ROLE:
 * Shows execution progress as sequence of pipeline steps (llm -> format -> image -> tts -> upload -> publish).
 * Provides visual feedback on which step is active, completed, or failed.
 *
 * DESIGN PATTERN:
 * - Pipeline visualization: Linear progression through canonical job status sequence
 * - Status indicators: Icons + colors reveal job execution state
 * - State-based styling: Colors and icons vary by step completion
 *
 * VISUAL INDICATORS:
 * - Gray dot: Step not yet reached (future)
 * - Blue radio button: Currently executing on this step
 * - Green checkmark: Step completed successfully
 * - Red X: Failed at this step (terminal error)
 * - Paused indicator: Paused jobs visually anchored at llm_generating step
 *
 * DISPLAYED STEPS:
 * Filters out pending/completed/paused from JOB_STATUS_ORDER to show only
 * the active pipeline stages: llm_generating -> qa_formatting -> image_generating
 * -> tts_pending -> tts_converting -> post_processing -> uploading -> publishing
 *
 * USAGE EXAMPLE:
 * ```tsx
 * <PipelineStepper currentStatus={job.status} />
 * ```
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { JobStatus, JOB_STATUS_ORDER, JOB_STATUS_LABELS } from '../types';
import { Theme } from '@/theme';

interface PipelineStepperProps {
  currentStatus: JobStatus;
}

const PIPELINE_STEPS = JOB_STATUS_ORDER.filter(
  (s) => s !== 'pending' && s !== 'completed' && s !== 'paused'
);

/**
 * Render linear pipeline stepper.
 * Maps each status to its icon and styling based on execution progress.
 */
export function PipelineStepper({ currentStatus }: PipelineStepperProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);

  // Paused jobs are visually anchored at llm_generating (show where they paused)
  const displayStatus = currentStatus === 'paused' ? 'llm_generating' : currentStatus;
  const currentIndex = JOB_STATUS_ORDER.indexOf(displayStatus);
  const isFailed = currentStatus === 'failed';
  const isCompleted = currentStatus === 'completed';

  return (
    <View style={styles.container}>
      {PIPELINE_STEPS.map((step, index) => {
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
    failedLabel: {
      fontFamily: 'DMSans-SemiBold',
      color: theme.colors.error,
    },
  });
