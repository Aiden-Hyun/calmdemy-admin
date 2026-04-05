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

export function PipelineStepper({ currentStatus }: PipelineStepperProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);

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
