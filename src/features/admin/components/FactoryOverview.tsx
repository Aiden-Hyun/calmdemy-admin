/**
 * Factory overview & worker control dashboard.
 *
 * ARCHITECTURAL ROLE:
 * Shows system-wide metrics (pending, active, completed) and worker control panel.
 * Allows admin to start/stop/restart local worker and configure auto-mode.
 *
 * KEY SECTIONS:
 * 1. Stats: Job queue counts (pending, active, paused, completed)
 * 2. Local Worker: Heartbeat status (online/stale/offline) + control buttons
 * 3. Stacks: Worker stack status (role, TTS models, pid, log path)
 * 4. Controls: Auto-mode toggle, start/stop buttons, idle timeout, restart
 *
 * WORKER STATE MACHINE:
 * - Auto mode: Worker starts on pending jobs, stops after idle timeout
 * - Manual: Start Now / Stop Now buttons directly control worker
 * - Optimistic UI: Local state tracks pending actions (start_clicked, stop_clicked)
 * - Heartbeat: Worker updates lastHeartbeat; stale detection via age > 2x poll interval
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import { WorkerRuntimeState, WorkerStatus, WorkerStackStatus } from '../types';

export type LocalUiState = WorkerRuntimeState | 'start_clicked' | 'stop_clicked';

export type WorkerCardState = {
  label: string;
  color: string;
  meta: string;
};

interface FactoryOverviewProps {
  pendingCount: number;
  activeCount: number;
  pausedCount: number;
  completedCount: number;
  localState: WorkerCardState;
  autoMode: boolean;
  idleTimeoutMin: number;
  controlStateLabel: string;
  lastAction: string;
  lastError?: string;
  controlsDisabled: boolean;
  restartInProgress: boolean;
  isOpen: boolean;
  stacks?: WorkerStackStatus[];
  logsOpen?: boolean;
  onToggle: () => void;
  onViewLogs?: () => void;
  onAutoModeChange: (next: boolean) => void;
  onStartNow: () => void;
  onStopNow: () => void;
  onRestart: () => void;
  onIdleTimeoutChange: (minutes: number) => void;
}

export function FactoryOverview({
  pendingCount,
  activeCount,
  pausedCount,
  completedCount,
  localState,
  autoMode,
  idleTimeoutMin,
  controlStateLabel,
  lastAction,
  lastError,
  controlsDisabled,
  restartInProgress,
  isOpen,
  stacks = [],
  logsOpen = false,
  onToggle,
  onViewLogs,
  onAutoModeChange,
  onStartNow,
  onStopNow,
  onRestart,
  onIdleTimeoutChange,
}: FactoryOverviewProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [stacksOpen, setStacksOpen] = useState(true);

  const stacksMeta = useMemo(() => {
    if (!stacks.length) return '';
    const total = stacks.length;
    const enabled = stacks.filter((s) => s.enabled !== false).length;
    const running = stacks.filter((s) => Boolean(s.pid)).length;
    const mostRecentMs = stacks.reduce((max, stack) => {
      const ts = getTimestampMs(stack.lastUpdatedAt);
      if (!ts) return max;
      return Math.max(max, ts);
    }, 0);
    const freshness = mostRecentMs > 0
      ? ` · updated ${formatAge(Math.max(0, (Date.now() - mostRecentMs) / 1000))}`
      : '';
    return `${running}/${enabled} running · ${total} total${freshness}`;
  }, [stacks]);

  return (
    <View style={styles.overviewCard}>
      <Pressable
        style={({ pressed }) => [
          styles.overviewHeader,
          pressed && { opacity: 0.85 },
        ]}
        onPress={onToggle}
      >
        <View style={styles.overviewTitleRow}>
          <Ionicons name="grid-outline" size={18} color={theme.colors.text} />
          <Text style={styles.overviewTitle}>Factory Overview</Text>
        </View>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.colors.textMuted}
        />
      </Pressable>

      {isOpen ? (
        <>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: `${theme.colors.primary}15` }]}>
              <Text style={[styles.statNumber, { color: theme.colors.primary }]}>
                {pendingCount}
              </Text>
              <Text style={styles.statLabel}>Queued</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: `${theme.colors.warning}15` }]}>
              <Text style={[styles.statNumber, { color: theme.colors.warning }]}>
                {activeCount}
              </Text>
              <Text style={styles.statLabel}>Processing</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: `${theme.colors.textMuted}15` }]}>
              <Text style={[styles.statNumber, { color: theme.colors.textMuted }]}>
                {pausedCount}
              </Text>
              <Text style={styles.statLabel}>Paused</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: `${theme.colors.success}15` }]}>
              <Text style={[styles.statNumber, { color: theme.colors.success }]}>
                {completedCount}
              </Text>
              <Text style={styles.statLabel}>Done</Text>
            </View>
          </View>

          <View style={styles.workerRow}>
            <View style={[styles.workerCard, { borderColor: localState.color }]}>
              <View style={styles.workerHeader}>
                <Ionicons name="laptop-outline" size={18} color={localState.color} />
                <Text style={styles.workerTitle}>Local Worker</Text>
              </View>
              <Text style={[styles.workerStatus, { color: localState.color }]}>
                {localState.label}
              </Text>
              <Text style={styles.workerMeta}>{localState.meta}</Text>
            </View>
          </View>

          {stacks.length > 0 ? (
            <View style={styles.stacksCard}>
              <View style={styles.stacksHeaderRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.stacksHeaderPressable,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => setStacksOpen((prev) => !prev)}
                >
                  <View style={styles.stacksHeader}>
                    <Ionicons name="layers-outline" size={16} color={theme.colors.text} />
                    <Text style={styles.stacksTitle}>Stacks</Text>
                  </View>
                  <Ionicons
                    name={stacksOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.colors.textMuted}
                  />
                </Pressable>
                <View style={styles.stackActions}>
                  {onViewLogs ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.logsButton,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={onViewLogs}
                    >
                      <Ionicons
                        name={logsOpen ? 'eye-off-outline' : 'eye-outline'}
                        size={13}
                        color={theme.colors.text}
                      />
                      <Text style={styles.logsButtonText}>
                        {logsOpen ? 'Hide Logs' : 'View Logs'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {stacksOpen ? (
                stacks.map((stack) => {
                  const status = getStackStatus(stack, theme);
                  const modeLabel = stack.dispatch ? 'dispatcher' : 'executor';
                  const ttsModels = stack.ttsModels?.length
                    ? stack.ttsModels.join(', ')
                    : stack.acceptNonTtsSteps
                      ? '*'
                      : '-';
                  return (
                    <View key={stack.id} style={styles.stackRow}>
                      <View style={styles.stackLeft}>
                        <Text style={styles.stackId}>{stack.id}</Text>
                        <Text style={styles.stackMeta}>
                          {stack.role || 'role?'} · {stack.venv || 'venv?'} · {modeLabel}
                        </Text>
                        <Text style={styles.stackMeta}>tts: {ttsModels}</Text>
                      </View>
                      <View style={styles.stackRight}>
                        <Text style={[styles.stackStatus, { color: status.color }]}>
                          {status.label}
                        </Text>
                        {stack.logPath ? (
                          <Text style={styles.stackMeta}>log: {stack.logPath}</Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.stacksCollapsedMeta}>{stacksMeta}</Text>
              )}
            </View>
          ) : null}

          <View style={styles.controlCard}>
            <View style={styles.controlHeader}>
              <Ionicons name="settings-outline" size={18} color={theme.colors.text} />
              <Text style={styles.controlTitle}>Local Worker Controls</Text>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>Auto mode</Text>
                <Text style={styles.toggleDescription}>
                  Start when queued jobs exist, stop after idle
                </Text>
              </View>
              <Switch
                value={autoMode}
                onValueChange={onAutoModeChange}
                trackColor={{ false: theme.colors.gray[300], true: `${theme.colors.primary}80` }}
                thumbColor={autoMode ? theme.colors.primary : theme.colors.gray[400]}
              />
            </View>

            <View style={styles.controlActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.controlButton,
                  { backgroundColor: theme.colors.success },
                  pressed && { opacity: 0.85 },
                  controlsDisabled && { opacity: 0.6 },
                ]}
                disabled={controlsDisabled}
                onPress={onStartNow}
              >
                <Text style={styles.controlButtonText}>Start Now</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.controlButton,
                  { backgroundColor: theme.colors.error },
                  pressed && { opacity: 0.85 },
                  controlsDisabled && { opacity: 0.6 },
                ]}
                disabled={controlsDisabled}
                onPress={onStopNow}
              >
                <Text style={styles.controlButtonText}>Stop Now</Text>
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.controlButton,
                styles.controlButtonFull,
                styles.controlButtonRow,
                { backgroundColor: theme.colors.info },
                pressed && { opacity: 0.85 },
                controlsDisabled && { opacity: 0.6 },
              ]}
              disabled={controlsDisabled}
              onPress={onRestart}
            >
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.controlButtonText}>
                {restartInProgress ? 'Restarting...' : 'Restart Worker'}
              </Text>
            </Pressable>

            <View style={styles.idleRow}>
              <Text style={styles.idleLabel}>Idle Timeout</Text>
              <View style={styles.idleChips}>
                {[5, 10, 30].map((min) => (
                  <Pressable
                    key={min}
                    style={[
                      styles.idleChip,
                      idleTimeoutMin === min && styles.idleChipActive,
                    ]}
                    onPress={() => onIdleTimeoutChange(min)}
                  >
                    <Text
                      style={[
                        styles.idleChipText,
                        idleTimeoutMin === min && styles.idleChipTextActive,
                      ]}
                    >
                      {min}m
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.controlMeta}>
              <Text style={styles.metaText}>State: {controlStateLabel}</Text>
              <Text style={styles.metaText}>Last action: {lastAction}</Text>
              {lastError ? (
                <Text style={[styles.metaText, styles.metaError]}>
                  Error: {lastError}
                </Text>
              ) : null}
            </View>
          </View>
        </>
      ) : (
        <View style={styles.overviewCollapsedMeta}>
          <Text style={styles.overviewCollapsedText}>
            {pendingCount} queued · {activeCount} processing · {completedCount} done
          </Text>
        </View>
      )}
    </View>
  );
}

export function getWorkerState(status: WorkerStatus | null, theme: Theme): WorkerCardState {
  if (!status || !status.lastHeartbeat) {
    return {
      label: 'Offline',
      color: theme.colors.error,
      meta: 'No heartbeat',
    };
  }

  const last = status.lastHeartbeat.toDate
    ? status.lastHeartbeat.toDate().getTime()
    : new Date(status.lastHeartbeat as any).getTime();

  const ageSec = Math.max(0, (Date.now() - last) / 1000);
  const interval = status.pollIntervalSec ?? 15;

  if (ageSec <= interval * 2) {
    return {
      label: 'Online',
      color: theme.colors.success,
      meta: `Updated ${formatAge(ageSec)}`,
    };
  }
  if (ageSec <= interval * 6) {
    return {
      label: 'Stale',
      color: theme.colors.warning,
      meta: `Updated ${formatAge(ageSec)}`,
    };
  }
  return {
    label: 'Offline',
    color: theme.colors.error,
    meta: `Last seen ${formatAge(ageSec)}`,
  };
}

export function getControlStateLabel(
  state?: WorkerRuntimeState,
  optimisticState?: LocalUiState | null
): string {
  const effective = optimisticState ?? state;
  if (!effective) return 'Unknown';
  if (effective === 'start_clicked') return 'Start now clicked';
  if (effective === 'stop_clicked') return 'Stop now clicked';
  if (effective === 'running') return 'Running';
  if (effective === 'starting') return 'Starting';
  if (effective === 'stopping') return 'Stopping';
  return 'Stopped';
}

export function getLocalWorkerState(
  status: WorkerStatus | null,
  control: { currentState?: WorkerRuntimeState } | null,
  theme: Theme,
  optimisticState?: LocalUiState | null
): WorkerCardState {
  const heartbeat = getWorkerState(status, theme);
  const effectiveState = optimisticState ?? control?.currentState;

  if (!effectiveState) {
    return heartbeat;
  }

  if (effectiveState === 'start_clicked') {
    return {
      label: 'Start now clicked',
      color: theme.colors.warning,
      meta: 'Waiting for companion...',
    };
  }

  if (effectiveState === 'stop_clicked') {
    return {
      label: 'Stop now clicked',
      color: theme.colors.warning,
      meta: 'Waiting for companion...',
    };
  }

  if (effectiveState === 'stopped') {
    return {
      label: 'Stopped',
      color: theme.colors.textMuted,
      meta: 'Stopped by control',
    };
  }
  if (effectiveState === 'starting') {
    return {
      label: 'Starting',
      color: theme.colors.warning,
      meta: 'Starting worker...',
    };
  }
  if (effectiveState === 'stopping') {
    return {
      label: 'Stopping',
      color: theme.colors.warning,
      meta: 'Stopping worker...',
    };
  }
  if (effectiveState === 'running') {
    if (heartbeat.label === 'Online') {
      return { label: 'Running', color: theme.colors.success, meta: heartbeat.meta };
    }
    if (heartbeat.label === 'Stale') {
      return { label: 'Running (stale)', color: theme.colors.warning, meta: heartbeat.meta };
    }
    return { label: 'Running (no heartbeat)', color: theme.colors.error, meta: heartbeat.meta };
  }

  return heartbeat;
}

function formatAge(ageSec: number): string {
  if (ageSec < 10) return 'just now';
  if (ageSec < 60) return `${Math.floor(ageSec)}s ago`;
  const minutes = Math.floor(ageSec / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function getStackStatus(stack: WorkerStackStatus, theme: Theme) {
  if (stack.enabled === false) {
    return { label: 'Disabled', color: theme.colors.textMuted };
  }
  if (stack.pid) {
    return { label: `Running (pid ${stack.pid})`, color: theme.colors.success };
  }
  return { label: 'Stopped', color: theme.colors.error };
}

function getTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'object' && value !== null && 'toDate' in (value as any)) {
    const date = (value as any).toDate?.();
    return date ? date.getTime() : 0;
  }
  const date = new Date(value as any);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    statsRow: {
      flexDirection: 'row',
      paddingTop: 8,
      paddingBottom: 8,
      gap: 10,
    },
    workerRow: {
      flexDirection: 'row',
      paddingBottom: 8,
      gap: 10,
    },
    workerCard: {
      flex: 1,
      borderRadius: 14,
      padding: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
    },
    workerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    workerTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    workerStatus: {
      fontFamily: 'DMSans-Bold',
      fontSize: 16,
    },
    workerMeta: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    controlCard: {
      borderRadius: 14,
      padding: 12,
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      minHeight: 280,
    },
    controlHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 10,
    },
    controlTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 13,
      color: theme.colors.text,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    toggleInfo: {
      flex: 1,
      marginRight: 16,
    },
    toggleLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 14,
      color: theme.colors.text,
    },
    toggleDescription: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    controlActionsRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
    },
    controlButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
    },
    controlButtonRow: {
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
    },
    controlButtonFull: {
      marginTop: 10,
    },
    controlButtonText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 13,
      color: '#fff',
    },
    idleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
    },
    idleLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    idleChips: {
      flexDirection: 'row',
      gap: 6,
    },
    idleChip: {
      borderRadius: 10,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
    },
    idleChipActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    idleChipText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    idleChipTextActive: {
      color: '#fff',
    },
    controlMeta: {
      marginTop: 12,
      gap: 4,
    },
    metaText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    metaError: {
      color: theme.colors.error,
    },
    overviewCard: {
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 8,
      borderRadius: 16,
      padding: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
    },
    overviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    overviewTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    overviewTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 15,
      color: theme.colors.text,
    },
    overviewCollapsedMeta: {
      marginTop: 8,
    },
    overviewCollapsedText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    statCard: {
      flex: 1,
      borderRadius: 14,
      padding: 14,
      alignItems: 'center',
    },
    statNumber: {
      fontFamily: 'DMSans-Bold',
      fontSize: 24,
    },
    statLabel: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    stacksCard: {
      marginTop: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      padding: 10,
      backgroundColor: theme.colors.background,
      gap: 6,
    },
    stacksHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    stacksHeaderPressable: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flex: 1,
    },
    stackActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginLeft: 8,
    },
    stacksHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    stacksTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 13,
      color: theme.colors.text,
    },
    logsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.gray[300],
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    logsButtonText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.text,
    },
    stackRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 4,
    },
    stackLeft: {
      flex: 1,
    },
    stackRight: {
      alignItems: 'flex-end',
      flex: 1,
    },
    stackId: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 13,
      color: theme.colors.text,
    },
    stackMeta: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: 2,
    },
    stackStatus: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 12,
    },
    stacksCollapsedMeta: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
      paddingVertical: 4,
    },
  });
