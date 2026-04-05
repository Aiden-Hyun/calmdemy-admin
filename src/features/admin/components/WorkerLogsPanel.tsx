import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useWorkerLogTail } from '../hooks/useJobQueue';
import { WorkerStackStatus, WorkerLogEntry } from '../types';
import { Theme } from '@/theme';

type LevelFilter = 'all' | 'INFO' | 'WARNING' | 'ERROR';
type SortOrder = 'asc' | 'desc';

interface WorkerLogsPanelProps {
  stacks: WorkerStackStatus[];
  isOpen: boolean;
  onToggle: () => void;
}

const LEVEL_ORDER: Record<string, number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  WARN: 30,
  ERROR: 40,
  CRITICAL: 50,
};

export function WorkerLogsPanel({ stacks, isOpen, onToggle }: WorkerLogsPanelProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [selectedStackId, setSelectedStackId] = useState<string>('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [copyHint, setCopyHint] = useState<string>('');
  const { tail } = useWorkerLogTail(selectedStackId, refreshNonce);

  useEffect(() => {
    const availableIds = stacks.map((s) => s.id);
    if (!availableIds.length) {
      setSelectedStackId('');
      return;
    }
    if (!selectedStackId || !availableIds.includes(selectedStackId)) {
      setSelectedStackId(availableIds[0]);
    }
  }, [stacks, selectedStackId]);

  const filteredLinesChronological = useMemo(() => {
    const lines = tail?.lines || [];
    return levelFilter === 'all'
      ? lines
      : lines.filter((line) => {
      const level = String(line.level || 'INFO').toUpperCase();
      return (LEVEL_ORDER[level] || LEVEL_ORDER.INFO) >= LEVEL_ORDER[levelFilter];
    });
  }, [tail?.lines, levelFilter]);

  const orderedLines = useMemo(() => {
    return sortOrder === 'desc'
      ? [...filteredLinesChronological].reverse()
      : filteredLinesChronological;
  }, [filteredLinesChronological, sortOrder]);

  const updatedLabel = formatUpdatedLabel(tail?.updatedAt);

  const handleCopy = async () => {
    const text = buildLogText(orderedLines);
    if (!text.trim()) {
      setCopyHint('No lines to copy');
      return;
    }

    try {
      const clipboard = require('expo-clipboard');
      if (clipboard?.setStringAsync) {
        await clipboard.setStringAsync(text);
        setCopyHint('Copied to clipboard');
        return;
      }
    } catch {
      // Optional dependency not installed; fallback below.
    }

    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopyHint('Copied to clipboard');
        return;
      }
      await Share.share({ message: text });
      setCopyHint('Shared log text');
    } catch {
      setCopyHint('Copy failed');
    }
  };

  useEffect(() => {
    if (!copyHint) return;
    const timer = setTimeout(() => setCopyHint(''), 1600);
    return () => clearTimeout(timer);
  }, [copyHint]);

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [
          styles.header,
          pressed && { opacity: 0.85 },
        ]}
        onPress={onToggle}
      >
        <View style={styles.titleRow}>
          <Ionicons name="document-text-outline" size={18} color={theme.colors.text} />
          <Text style={styles.title}>Worker Logs</Text>
        </View>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={theme.colors.textMuted}
        />
      </Pressable>

      {!isOpen ? null : (
        <View style={styles.content}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stackChips}>
            {stacks.map((stack) => {
              const selected = stack.id === selectedStackId;
              return (
                <Pressable
                  key={stack.id}
                  style={[
                    styles.stackChip,
                    selected && styles.stackChipActive,
                  ]}
                  onPress={() => setSelectedStackId(stack.id)}
                >
                  <Text style={[styles.stackChipText, selected && styles.stackChipTextActive]}>
                    {stack.id}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.levelRow}>
            {(['all', 'INFO', 'WARNING', 'ERROR'] as LevelFilter[]).map((value) => {
              const selected = levelFilter === value;
              return (
                <Pressable
                  key={value}
                  style={[styles.levelChip, selected && styles.levelChipActive]}
                  onPress={() => setLevelFilter(value)}
                >
                  <Text style={[styles.levelChipText, selected && styles.levelChipTextActive]}>
                    {value === 'all' ? 'All' : value}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actionsRow}>
            <Text style={styles.updatedText}>
              {updatedLabel}
            </Text>
            <View style={styles.actionsRight}>
              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
                onPress={() => setRefreshNonce((v) => v + 1)}
              >
                <Ionicons name="refresh" size={14} color={theme.colors.text} />
                <Text style={styles.actionText}>Refresh</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
                onPress={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              >
                <Ionicons name="swap-vertical" size={14} color={theme.colors.text} />
                <Text style={styles.actionText}>
                  {sortOrder === 'desc' ? 'Newest' : 'Oldest'}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
                onPress={handleCopy}
              >
                <Ionicons name="copy-outline" size={14} color={theme.colors.text} />
                <Text style={styles.actionText}>Copy</Text>
              </Pressable>
            </View>
          </View>
          {copyHint ? <Text style={styles.copyHint}>{copyHint}</Text> : null}

          <ScrollView style={styles.logBox}>
            {orderedLines.length === 0 ? (
              <Text style={styles.emptyText}>No log lines yet for this stack.</Text>
            ) : (
              orderedLines.map((line, index) => {
                const lineNumber = getLineNumber(
                  index,
                  filteredLinesChronological.length,
                  sortOrder
                );
                return (
                  <View key={`${line.timestamp || 'row'}-${index}`} style={styles.logLine}>
                  <Text style={styles.logMeta}>
                    #{lineNumber} [{(line.level || 'INFO').toUpperCase()}] {formatLogTimestamp(line.timestamp)}
                  </Text>
                  <Text style={styles.logMessage}>{line.message || line.raw || ''}</Text>
                </View>
              )})
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function buildLogText(lines: WorkerLogEntry[]): string {
  return lines
    .map((line) => {
      const level = (line.level || 'INFO').toUpperCase();
      const timestamp = line.timestamp || '';
      const message = line.message || line.raw || '';
      return `${timestamp} [${level}] ${message}`.trim();
    })
    .join('\n');
}

function formatUpdatedLabel(updatedAt: unknown): string {
  if (!updatedAt) return 'Updated: never';
  let timestampMs = 0;
  if (typeof updatedAt === 'object' && updatedAt !== null && 'toDate' in (updatedAt as any)) {
    timestampMs = (updatedAt as any).toDate().getTime();
  } else {
    timestampMs = new Date(updatedAt as string).getTime();
  }
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 'Updated: unknown';
  const absolute = formatAbsoluteDateTime(timestampMs);
  const ageSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (ageSec < 5) return `Updated: ${absolute} (just now)`;
  if (ageSec < 60) return `Updated: ${absolute} (${ageSec}s ago)`;
  if (ageSec < 3600) return `Updated: ${absolute} (${Math.floor(ageSec / 60)}m ago)`;
  return `Updated: ${absolute} (${Math.floor(ageSec / 3600)}h ago)`;
}

function formatLogTimestamp(timestamp?: string): string {
  if (!timestamp) return 'no-ts';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return formatAbsoluteDateTime(date.getTime());
}

function formatAbsoluteDateTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getLineNumber(index: number, total: number, sortOrder: SortOrder): number {
  if (sortOrder === 'desc') {
    return total - index;
  }
  return index + 1;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 8,
      borderRadius: 16,
      padding: 12,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 15,
      color: theme.colors.text,
    },
    content: {
      marginTop: 10,
      gap: 10,
    },
    stackChips: {
      gap: 8,
      paddingRight: 8,
    },
    stackChip: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.gray[300],
      backgroundColor: theme.colors.background,
    },
    stackChipActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    stackChipText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    stackChipTextActive: {
      color: '#fff',
    },
    levelRow: {
      flexDirection: 'row',
      gap: 8,
    },
    levelChip: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.gray[300],
      backgroundColor: theme.colors.background,
    },
    levelChipActive: {
      borderColor: theme.colors.text,
      backgroundColor: theme.colors.surface,
    },
    levelChipText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    levelChipTextActive: {
      color: theme.colors.text,
    },
    actionsRow: {
      gap: 8,
    },
    actionsRight: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'center',
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.gray[300],
    },
    actionText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      color: theme.colors.text,
    },
    updatedText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    copyHint: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: -4,
    },
    logBox: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      backgroundColor: theme.colors.background,
      padding: 10,
      maxHeight: 260,
    },
    emptyText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    logLine: {
      marginBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.gray[200],
      paddingBottom: 8,
    },
    logMeta: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 10,
      color: theme.colors.textMuted,
      marginBottom: 3,
    },
    logMessage: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.text,
    },
  });
