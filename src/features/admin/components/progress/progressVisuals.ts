/**
 * Visual styling utilities for progress states in course pipeline view.
 *
 * ARCHITECTURAL ROLE:
 * Maps ProgressState enum to consistent visual representation (colors, icons, backgrounds).
 * Ensures unified styling across CoursePipelineMap and WorkerSwimlanes components.
 *
 * DESIGN PATTERN:
 * - State-based styling: Each state has canonical icon and color
 * - RGBA generation: Creates semantic tints (0.05 rowTint, 0.16 iconTint, etc.)
 * - Theme bridge: Adapts accent colors to user theme (light/dark mode support)
 *
 * COLOR SEMANTICS:
 * - running (blue): Active execution
 * - succeeded (green): Successful completion
 * - failed (red): Terminal error state
 * - retrying (amber): Scheduled retry
 * - queued (orange): Waiting for dispatch
 * - waiting (gray): Blocked/paused
 * - cancelled (slate): Explicitly terminated
 */

import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/theme';
import { ProgressState, progressStateLabel } from './courseProgressModel';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type VisualSpec = {
  color: string;
  icon: IoniconName;
};

const STATE_VISUALS: Record<ProgressState, VisualSpec> = {
  running: { color: '#0EA5E9', icon: 'play' },
  succeeded: { color: '#16A34A', icon: 'checkmark' },
  failed: { color: '#DC2626', icon: 'close' },
  retrying: { color: '#F59E0B', icon: 'refresh' },
  queued: { color: '#D97706', icon: 'time' },
  waiting: { color: '#6B7280', icon: 'pause' },
  cancelled: { color: '#475569', icon: 'remove' },
};

function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '');
  const safe =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized.padStart(6, '0').slice(0, 6);
  const r = parseInt(safe.slice(0, 2), 16);
  const g = parseInt(safe.slice(2, 4), 16);
  const b = parseInt(safe.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export type ProgressVisual = {
  color: string;
  icon: IoniconName;
  rail: string;
  rowTint: string;
  iconTint: string;
  pillBackground: string;
  pillBorder: string;
  pillText: string;
};

export function getProgressVisual(state: ProgressState): ProgressVisual {
  const spec = STATE_VISUALS[state];
  return {
    color: spec.color,
    icon: spec.icon,
    rail: hexToRgba(spec.color, 0.45),
    rowTint: hexToRgba(spec.color, 0.05),
    iconTint: hexToRgba(spec.color, 0.16),
    pillBackground: spec.color,
    pillBorder: hexToRgba(spec.color, 0.8),
    pillText: '#FFFFFF',
  };
}

export function getSummaryChipColors(state: ProgressState, theme: Theme) {
  const visual = getProgressVisual(state);
  return {
    backgroundColor: hexToRgba(visual.color, 0.13),
    borderColor: hexToRgba(visual.color, 0.35),
    textColor: visual.color,
    fallbackBackgroundColor: theme.colors.gray[100],
  };
}

export function getStatusLabel(state: ProgressState): string {
  return progressStateLabel(state);
}

export function truncateText(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
