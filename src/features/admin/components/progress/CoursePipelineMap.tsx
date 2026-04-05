import React, { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import {
  COURSE_SHARD_KEYS,
  CourseProgressModel,
  ProgressState,
} from './courseProgressModel';
import {
  getProgressVisual,
  getStatusLabel,
  getSummaryChipColors,
  truncateText,
} from './progressVisuals';

type Props = {
  model: CourseProgressModel;
};

type ProgressRowProps = {
  label: string;
  subtitle?: string;
  state: ProgressState;
  attempt?: number;
  workerLabel?: string;
  errorCode?: string;
  errorMessage?: string;
};

function buildMetaLines(attempt?: number, workerLabel?: string): string[] {
  const lines: string[] = [];
  if (typeof attempt === 'number') lines.push(`Attempt ${attempt}`);
  if (workerLabel) lines.push(`Worker ${workerLabel}`);
  return lines;
}

function ProgressRow({
  label,
  subtitle,
  state,
  attempt,
  workerLabel,
  errorCode,
  errorMessage,
}: ProgressRowProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const visual = getProgressVisual(state);
  const errorText = [errorCode, errorMessage].filter(Boolean).join(': ');
  const metaLines = buildMetaLines(attempt, workerLabel);

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: visual.rowTint,
          borderLeftColor: visual.rail,
        },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: visual.iconTint }]}>
        <Ionicons name={visual.icon} size={14} color={visual.color} />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitleText} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {metaLines.map((line) => (
          <Text key={line} style={styles.metaText} numberOfLines={1}>
            {line}
          </Text>
        ))}
        {Boolean(errorText) ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {truncateText(errorText, 140)}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          styles.statusPill,
          {
            backgroundColor: visual.pillBackground,
            borderColor: visual.pillBorder,
          },
        ]}
      >
        <Text style={[styles.statusPillText, { color: visual.pillText }]}>
          {getStatusLabel(state)}
        </Text>
      </View>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function SummaryChip({
  label,
  value,
  state,
}: {
  label: string;
  value: number;
  state: ProgressState;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const colors = getSummaryChipColors(state, theme);
  return (
    <View
      style={[
        styles.summaryChip,
        {
          backgroundColor: colors.backgroundColor || colors.fallbackBackgroundColor,
          borderColor: colors.borderColor,
        },
      ]}
    >
      <Text style={[styles.summaryChipText, { color: colors.textColor }]}>
        {label} {value}/9
      </Text>
    </View>
  );
}

export function CoursePipelineMap({ model }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { stages, audioSummary } = model;

  return (
    <View style={styles.container}>
      {model.selectedRunId ? (
        <View style={styles.runBadge}>
          <Ionicons name="git-branch-outline" size={12} color={theme.colors.textMuted} />
          <Text style={styles.runLabel} numberOfLines={1}>
            Run {model.selectedRunId}
          </Text>
        </View>
      ) : null}

      <ProgressRow
        label={stages.generate_course_plan.label}
        state={stages.generate_course_plan.state}
        attempt={stages.generate_course_plan.attempt}
        workerLabel={stages.generate_course_plan.workerLabel}
        errorCode={stages.generate_course_plan.errorCode}
        errorMessage={stages.generate_course_plan.errorMessage}
      />

      <SectionLabel text="Parallel Branch" />

      <ProgressRow
        label={stages.generate_course_thumbnail.label}
        state={stages.generate_course_thumbnail.state}
        attempt={stages.generate_course_thumbnail.attempt}
        workerLabel={stages.generate_course_thumbnail.workerLabel}
        errorCode={stages.generate_course_thumbnail.errorCode}
        errorMessage={stages.generate_course_thumbnail.errorMessage}
      />

      <ProgressRow
        label={stages.generate_course_scripts.label}
        state={stages.generate_course_scripts.state}
        attempt={stages.generate_course_scripts.attempt}
        workerLabel={stages.generate_course_scripts.workerLabel}
        errorCode={stages.generate_course_scripts.errorCode}
        errorMessage={stages.generate_course_scripts.errorMessage}
      />

      <SectionLabel text="Join" />

      <ProgressRow
        label={stages.format_course_scripts.label}
        state={stages.format_course_scripts.state}
        attempt={stages.format_course_scripts.attempt}
        workerLabel={stages.format_course_scripts.workerLabel}
        errorCode={stages.format_course_scripts.errorCode}
        errorMessage={stages.format_course_scripts.errorMessage}
      />

      <SectionLabel text="Fan-Out" />

      <ProgressRow
        label={stages.synthesize_course_audio.label}
        state={stages.synthesize_course_audio.state}
        attempt={stages.synthesize_course_audio.attempt}
        workerLabel={stages.synthesize_course_audio.workerLabel}
        errorCode={stages.synthesize_course_audio.errorCode}
        errorMessage={stages.synthesize_course_audio.errorMessage}
      />

      <View style={styles.summaryRow}>
        <SummaryChip label="Running" value={audioSummary.running} state="running" />
        <SummaryChip label="Succeeded" value={audioSummary.succeeded} state="succeeded" />
        <SummaryChip label="Failed" value={audioSummary.failed} state="failed" />
      </View>

      {model.hasLegacyRootSynth ? (
        <View style={styles.legacyWarning}>
          <Ionicons name="warning-outline" size={14} color={theme.colors.warning} />
          <Text style={styles.legacyText}>
            Legacy root synth run detected. Session-level breakdown is unavailable for this run.
          </Text>
        </View>
      ) : (
        <View style={styles.shardList}>
          {COURSE_SHARD_KEYS.map((shardKey) => {
            const shard = model.audioShards[shardKey];
            return (
              <ProgressRow
                key={shardKey}
                label={shard.label}
                subtitle={`Session ${shard.shardKey}`}
                state={shard.state}
                attempt={shard.attempt}
                workerLabel={shard.workerId || 'unknown'}
                errorCode={shard.errorCode}
                errorMessage={shard.errorMessage}
              />
            );
          })}
        </View>
      )}

      <SectionLabel text="Fan-In" />

      <ProgressRow
        label={stages.upload_course_audio.label}
        state={stages.upload_course_audio.state}
        attempt={stages.upload_course_audio.attempt}
        workerLabel={stages.upload_course_audio.workerLabel}
        errorCode={stages.upload_course_audio.errorCode}
        errorMessage={stages.upload_course_audio.errorMessage}
      />
      {model.uploadBlockedReason ? (
        <View style={styles.blockedNotice}>
          <Ionicons name="lock-closed-outline" size={14} color={theme.colors.warning} />
          <Text style={styles.blockedText}>{model.uploadBlockedReason}</Text>
        </View>
      ) : null}

      <ProgressRow
        label={stages.publish_course.label}
        state={stages.publish_course.state}
        attempt={stages.publish_course.attempt}
        workerLabel={stages.publish_course.workerLabel}
        errorCode={stages.publish_course.errorCode}
        errorMessage={stages.publish_course.errorMessage}
      />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: 12,
    },
    runBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      backgroundColor: theme.colors.gray[100],
    },
    runLabel: {
      maxWidth: 220,
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    sectionLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    row: {
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      borderLeftWidth: 4,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      minWidth: 0,
    },
    iconCircle: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    rowMain: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    rowTitle: {
      fontFamily: 'DMSans-Bold',
      fontSize: 16,
      lineHeight: 22,
      color: theme.colors.text,
    },
    subtitleText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.textMuted,
    },
    metaText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.textMuted,
    },
    errorText: {
      marginTop: 2,
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.error,
    },
    statusPill: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      alignSelf: 'center',
      marginLeft: 6,
    },
    statusPillText: {
      fontFamily: 'DMSans-Bold',
      fontSize: 11,
      lineHeight: 14,
    },
    summaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    summaryChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    summaryChipText: {
      fontFamily: 'DMSans-Bold',
      fontSize: 12,
    },
    shardList: {
      gap: 10,
    },
    blockedNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.warning,
      backgroundColor: theme.colors.gray[100],
    },
    blockedText: {
      flex: 1,
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
      lineHeight: 17,
      color: theme.colors.warning,
    },
    legacyWarning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.warning,
      backgroundColor: theme.colors.gray[100],
    },
    legacyText: {
      flex: 1,
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      lineHeight: 17,
      color: theme.colors.textMuted,
    },
  });
