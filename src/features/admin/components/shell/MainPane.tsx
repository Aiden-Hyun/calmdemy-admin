/**
 * Central content pane showing jobs list, factory metrics, and worker controls.
 *
 * ARCHITECTURAL ROLE:
 * Middle column: displays all jobs in scrollable list, factory overview stats,
 * worker log viewer, filter chips, and draft jobs section.
 *
 * DESIGN PATTERN:
 * - Composite layout: FlatList with header (factory overview, filters, drafts)
 * - Separation of concerns: Props passed through, no local state mutations
 * - Responsive: Full width on mobile, flex-grow in 3-pane desktop
 *
 * CONTENT STRUCTURE:
 * Header (sticky):
 *   - FactoryOverview: Queue counts, worker heartbeat, controls
 *   - WorkerLogsPanel: Log viewer with level/stack filtering
 *   - FiltersRow: Status filter chips (All, Pending, Active, etc.)
 *   - DraftsSection: Locally saved draft jobs
 * Body:
 *   - JobList: Hierarchical list (parent full_subject with child courses)
 * Footer:
 *   - Extra spacing for mobile scrolling
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { FactoryOverview, LocalUiState, WorkerCardState } from '../FactoryOverview';
import { WorkerLogsPanel } from '../WorkerLogsPanel';
import { FiltersRow } from '../FiltersRow';
import { JobList } from '../JobList';
import { DraftsSection } from '../DraftsSection';
import {
  ActiveJobWorker,
  ContentDraft,
  ContentJob,
  JobStatus,
  WorkerStackStatus,
} from '../../types';
import { Theme } from '@/theme';

export interface MainPaneProps {
  jobs: ContentJob[];
  isJobsLoading: boolean;
  activeWorkersByJobId: Record<string, ActiveJobWorker[]>;
  filter: JobStatus | undefined;
  drafts: ContentDraft[];
  stacks: WorkerStackStatus[];
  // FactoryOverview state
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
  overviewOpen: boolean;
  logsOpen: boolean;
  onToggleOverview: () => void;
  onToggleLogs: () => void;
  onAutoModeChange: (next: boolean) => void;
  onStartNow: () => void;
  onStopNow: () => void;
  onRestart: () => void;
  onIdleTimeoutChange: (minutes: number) => void;
  // Job list interactions
  onFilterChange: (next: JobStatus | undefined) => void;
  onJobSelect: (jobId: string) => void;
  onJobPublish: (job: ContentJob) => void;
  onJobGenerateThumbnail: (job: ContentJob) => void;
  onDraftSelect: (draftId: string) => void;
  onDraftDelete: (draftId: string) => Promise<void>;
}

export function MainPane(props: MainPaneProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const header = (
    <>
      <FactoryOverview
        pendingCount={props.pendingCount}
        activeCount={props.activeCount}
        pausedCount={props.pausedCount}
        completedCount={props.completedCount}
        localState={props.localState}
        autoMode={props.autoMode}
        idleTimeoutMin={props.idleTimeoutMin}
        controlStateLabel={props.controlStateLabel}
        lastAction={props.lastAction}
        lastError={props.lastError}
        controlsDisabled={props.controlsDisabled}
        restartInProgress={props.restartInProgress}
        isOpen={props.overviewOpen}
        stacks={props.stacks}
        logsOpen={props.logsOpen}
        onToggle={props.onToggleOverview}
        onViewLogs={props.onToggleLogs}
        onAutoModeChange={props.onAutoModeChange}
        onStartNow={props.onStartNow}
        onStopNow={props.onStopNow}
        onRestart={props.onRestart}
        onIdleTimeoutChange={props.onIdleTimeoutChange}
      />
      <WorkerLogsPanel
        stacks={props.stacks}
        isOpen={props.logsOpen}
        onToggle={props.onToggleLogs}
      />
      <FiltersRow selectedFilter={props.filter} onFilterChange={props.onFilterChange} />
      <DraftsSection
        drafts={props.drafts}
        onDelete={props.onDraftDelete}
        onSelect={props.onDraftSelect}
      />
    </>
  );

  return (
    <View style={styles.pane}>
      <JobList
        jobs={props.jobs}
        activeWorkersByJobId={props.activeWorkersByJobId}
        isLoading={props.isJobsLoading}
        hasDrafts={props.drafts.length > 0}
        onJobSelect={props.onJobSelect}
        onJobPublish={props.onJobPublish}
        onJobGenerateThumbnail={props.onJobGenerateThumbnail}
        headerComponent={header}
      />
    </View>
  );
}

export type { LocalUiState };

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    pane: {
      flex: 1,
      minWidth: 520,
      backgroundColor: theme.colors.background,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
    },
  });
