import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Sidebar, SidebarNavKey } from './Sidebar';
import { MainPane, MainPaneProps } from './MainPane';
import { InspectorPane } from './InspectorPane';
import { Theme } from '@/theme';

export interface AdminShellProps extends Omit<MainPaneProps, 'onJobSelect'> {
  openReportsCount: number;
  onNavigate: (key: SidebarNavKey) => void;
  onCreate: () => void;
  onSignOut: () => void;
}

export function AdminShell(props: AdminShellProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const workerStateLabel = props.localState.label;
  const workerStateColor = props.localState.color;

  return (
    <View style={styles.shell}>
      <Sidebar
        activeKey="dashboard"
        openReportsCount={props.openReportsCount}
        workerStateLabel={workerStateLabel}
        workerStateColor={workerStateColor}
        onNavigate={props.onNavigate}
        onCreate={props.onCreate}
        onSignOut={props.onSignOut}
      />
      <MainPane
        jobs={props.jobs}
        isJobsLoading={props.isJobsLoading}
        activeWorkersByJobId={props.activeWorkersByJobId}
        filter={props.filter}
        drafts={props.drafts}
        stacks={props.stacks}
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
        overviewOpen={props.overviewOpen}
        logsOpen={props.logsOpen}
        onToggleOverview={props.onToggleOverview}
        onToggleLogs={props.onToggleLogs}
        onAutoModeChange={props.onAutoModeChange}
        onStartNow={props.onStartNow}
        onStopNow={props.onStopNow}
        onRestart={props.onRestart}
        onIdleTimeoutChange={props.onIdleTimeoutChange}
        onFilterChange={props.onFilterChange}
        onJobSelect={setSelectedJobId}
        onJobPublish={props.onJobPublish}
        onJobGenerateThumbnail={props.onJobGenerateThumbnail}
        onDraftSelect={props.onDraftSelect}
        onDraftDelete={props.onDraftDelete}
      />
      <InspectorPane selectedJobId={selectedJobId} />
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    shell: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: theme.colors.background,
    },
  });
