import React, { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import { CourseProgressModel, ProgressState, WorkerLane, WorkerLaneItem } from './courseProgressModel';
import { getProgressVisual, getStatusLabel, truncateText } from './progressVisuals';

type Props = {
  model: CourseProgressModel;
};

export function WorkerSwimlanes({ model }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [expandedByWorker, setExpandedByWorker] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedByWorker((current) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const lane of model.workerLanes) {
        if (Object.prototype.hasOwnProperty.call(current, lane.workerId)) {
          next[lane.workerId] = current[lane.workerId];
          continue;
        }
        next[lane.workerId] = hasActiveLaneItem(lane);
        changed = true;
      }

      const currentKeys = Object.keys(current);
      if (currentKeys.length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [model.workerLanes]);

  const allExpanded =
    model.workerLanes.length > 0 &&
    model.workerLanes.every(
      (lane) => (expandedByWorker[lane.workerId] ?? hasActiveLaneItem(lane)) === true
    );

  if (model.workerLanes.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No worker timeline data available for this run.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        {model.selectedRunId ? (
          <View style={styles.runBadge}>
            <Ionicons name="git-branch-outline" size={12} color={theme.colors.textMuted} />
            <Text style={styles.runLabel} numberOfLines={1}>
              Run {model.selectedRunId}
            </Text>
          </View>
        ) : (
          <View />
        )}

        <Pressable
          onPress={() =>
            setExpandedByWorker(() =>
              Object.fromEntries(
                model.workerLanes.map((lane) => [lane.workerId, !allExpanded])
              )
            )
          }
          style={({ pressed }) => [styles.bulkToggleButton, pressed && styles.bulkToggleButtonPressed]}
        >
          <Ionicons
            name={allExpanded ? 'contract-outline' : 'expand-outline'}
            size={14}
            color={theme.colors.text}
          />
          <Text style={styles.bulkToggleText}>{allExpanded ? 'Collapse All' : 'Expand All'}</Text>
        </Pressable>
      </View>

      {model.workerLanes.map((lane) => (
        <WorkerLaneCard
          key={lane.workerId}
          lane={lane}
          expanded={expandedByWorker[lane.workerId] ?? hasActiveLaneItem(lane)}
          onToggle={() =>
            setExpandedByWorker((current) => ({
              ...current,
              [lane.workerId]: !(current[lane.workerId] ?? hasActiveLaneItem(lane)),
            }))
          }
          styles={styles}
          theme={theme}
        />
      ))}
    </View>
  );
}

type WorkerLaneCardProps = {
  lane: WorkerLane;
  expanded: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
};

function WorkerLaneCard({ lane, expanded, onToggle, styles, theme }: WorkerLaneCardProps) {
  const summaryItem = selectSummaryItem(lane);
  const summaryVisual = summaryItem ? getProgressVisual(summaryItem.state) : null;
  const summaryLabel =
    summaryItem && ACTIVE_SUMMARY_STATES.has(summaryItem.state) ? 'Current' : 'Latest';

  return (
    <View style={styles.workerSection}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.workerHeader, pressed && styles.workerHeaderPressed]}
      >
        <View style={styles.workerHeaderMain}>
          <View style={styles.workerHeaderTop}>
            <Text style={styles.workerTitle}>{lane.workerId}</Text>
            <Text style={styles.workerMeta}>{lane.items.length} step runs</Text>
          </View>

          {!expanded && summaryItem ? (
            <View style={styles.summaryRow}>
              <View style={styles.summaryChip}>
                <Text style={styles.summaryChipLabel}>{summaryLabel}:</Text>
                <Text style={styles.summaryChipValue} numberOfLines={1}>
                  {truncateText(summaryItem.stepLabel, 40)}
                </Text>
              </View>
              {summaryItem.shardKey ? (
                <View style={styles.summaryChip}>
                  <Text style={styles.summaryChipLabel}>Session:</Text>
                  <Text style={styles.summaryChipValue} numberOfLines={1}>
                    {summaryItem.shardKey}
                  </Text>
                </View>
              ) : null}
              {typeof summaryItem.attempt === 'number' ? (
                <View style={styles.summaryChip}>
                  <Text style={styles.summaryChipLabel}>Attempt:</Text>
                  <Text style={styles.summaryChipValue} numberOfLines={1}>
                    {summaryItem.attempt}
                  </Text>
                </View>
              ) : null}
              {summaryVisual ? (
                <View
                  style={[
                    styles.summaryStatusChip,
                    {
                      backgroundColor: summaryVisual.pillBackground,
                      borderColor: summaryVisual.pillBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.summaryStatusChipText,
                      { color: summaryVisual.pillText },
                    ]}
                    numberOfLines={1}
                  >
                    {getStatusLabel(summaryItem.state)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.colors.textMuted}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.workerRows}>
          {lane.items.map((item) => {
            const visual = getProgressVisual(item.state);
            const errorText = [item.errorCode, item.errorMessage].filter(Boolean).join(': ');
            return (
              <View
                key={item.id}
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
                    {item.stepLabel}
                  </Text>
                  {item.shardLabel ? (
                    <Text style={styles.subtitleText} numberOfLines={1}>
                      {item.shardLabel}
                    </Text>
                  ) : null}
                  {item.shardKey ? (
                    <Text style={styles.metaText} numberOfLines={1}>
                      Session {item.shardKey}
                    </Text>
                  ) : null}
                  {typeof item.attempt === 'number' ? (
                    <Text style={styles.metaText} numberOfLines={1}>
                      Attempt {item.attempt}
                    </Text>
                  ) : null}
                  {Boolean(errorText) ? (
                    <Text style={styles.errorText} numberOfLines={2}>
                      {truncateText(errorText, 130)}
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
                    {getStatusLabel(item.state)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const SUMMARY_STATE_ORDER: ProgressState[] = [
  'running',
  'retrying',
  'queued',
  'failed',
  'succeeded',
  'cancelled',
  'waiting',
];

const ACTIVE_SUMMARY_STATES = new Set<ProgressState>(['running', 'retrying', 'queued']);

function hasActiveLaneItem(lane: WorkerLane): boolean {
  return lane.items.some((item) => ACTIVE_SUMMARY_STATES.has(item.state));
}

function selectSummaryItem(lane: WorkerLane): WorkerLaneItem | undefined {
  for (const state of SUMMARY_STATE_ORDER) {
    const matched = lane.items.find((item) => item.state === state);
    if (matched) return matched;
  }
  return lane.items[0];
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: 12,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    bulkToggleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      backgroundColor: theme.colors.surface,
    },
    bulkToggleButtonPressed: {
      opacity: 0.82,
    },
    bulkToggleText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
      color: theme.colors.text,
    },
    emptyState: {
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      borderRadius: 12,
      backgroundColor: theme.colors.gray[50],
      padding: 12,
    },
    emptyText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    workerSection: {
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      padding: 12,
      gap: 10,
    },
    workerHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
    },
    workerHeaderPressed: {
      opacity: 0.88,
    },
    workerHeaderMain: {
      flex: 1,
      minWidth: 0,
      gap: 8,
    },
    workerHeaderTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    workerTitle: {
      fontFamily: 'DMSans-Bold',
      fontSize: 14,
      color: theme.colors.text,
      flexShrink: 1,
    },
    workerMeta: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    summaryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    summaryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      backgroundColor: theme.colors.gray[100],
      maxWidth: '100%',
    },
    summaryChipLabel: {
      fontFamily: 'DMSans-Medium',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    summaryChipValue: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.text,
      maxWidth: 180,
    },
    summaryStatusChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    summaryStatusChipText: {
      fontFamily: 'DMSans-Bold',
      fontSize: 11,
      lineHeight: 14,
    },
    workerRows: {
      gap: 10,
    },
    row: {
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      borderLeftWidth: 4,
      borderRadius: 12,
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
      fontSize: 14,
      lineHeight: 20,
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
  });
