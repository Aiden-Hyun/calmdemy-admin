/**
 * Job list view with hierarchical grouping and pagination.
 *
 * ARCHITECTURAL ROLE:
 * Master view in Master-Detail pattern. Renders FlatList of JobCard components
 * with smart parent-child grouping for full_subject jobs.
 *
 * DESIGN PATTERNS:
 * - FlatList virtualization: Efficient rendering of large job lists
 * - Hierarchical grouping: Full subject jobs expanded to show child courses
 * - Loading/empty states: ActivityIndicator for loading, onboarding for empty
 *
 * GROUPING LOGIC:
 * buildJobGroups() nests course jobs under their parent full_subject job.
 * This creates visual hierarchy while maintaining single-list flat structure.
 * Child jobs indented with left border for visual distinction.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { ActiveJobWorker, ContentJob } from '../types';
import { JobCard } from './JobCard';
import { Theme } from '@/theme';

interface JobListProps {
  jobs: ContentJob[];
  activeWorkersByJobId?: Record<string, ActiveJobWorker[]>;
  isLoading: boolean;
  hasDrafts: boolean;
  onJobSelect: (jobId: string) => void;
  onJobPublish?: (job: ContentJob) => void;
  onJobGenerateThumbnail?: (job: ContentJob) => void;
  headerComponent?: React.ReactElement | null;
  footerComponent?: React.ReactElement | null;
}

interface JobGroup {
  parentJob: ContentJob;
  childJobs: ContentJob[];
}

export function JobList({
  jobs,
  activeWorkersByJobId = {},
  isLoading,
  hasDrafts,
  onJobSelect,
  onJobPublish,
  onJobGenerateThumbnail,
  headerComponent = null,
  footerComponent = null,
}: JobListProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const groupedJobs = useMemo(() => buildJobGroups(jobs), [jobs]);

  if (isLoading) {
    return (
      <FlatList
        data={[]}
        keyExtractor={(_, index) => `loading-${index}`}
        renderItem={() => null}
        ListHeaderComponent={headerComponent}
        ListFooterComponent={
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    );
  }

  if (jobs.length === 0 && !hasDrafts) {
    return (
      <FlatList
        data={[]}
        keyExtractor={(_, index) => `empty-${index}`}
        renderItem={() => null}
        ListHeaderComponent={headerComponent}
        ListFooterComponent={
          <View style={styles.center}>
            <Ionicons name="flask-outline" size={48} color={theme.colors.textMuted} />
            <Text style={styles.emptyText}>No jobs yet</Text>
            <Text style={styles.emptySubtext}>
              Tap + to create your first content
            </Text>
            {footerComponent}
          </View>
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <FlatList
      data={groupedJobs}
      keyExtractor={(item) => item.parentJob.id}
      renderItem={({ item }) => (
        <View style={styles.jobGroup}>
          <View style={styles.jobItem}>
            <JobCard
              job={item.parentJob}
              activeWorkers={activeWorkersByJobId[item.parentJob.id] || []}
              onPress={() => onJobSelect(item.parentJob.id)}
              onPublish={onJobPublish}
              onGenerateThumbnail={onJobGenerateThumbnail}
            />
          </View>

          {item.childJobs.length > 0 ? (
            <View style={styles.childJobs}>
              {item.childJobs.map((childJob) => (
                <View key={childJob.id} style={[styles.jobItem, styles.childJobItem]}>
                  <JobCard
                    job={childJob}
                    activeWorkers={activeWorkersByJobId[childJob.id] || []}
                    onPress={() => onJobSelect(childJob.id)}
                    onPublish={onJobPublish}
                    onGenerateThumbnail={onJobGenerateThumbnail}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      )}
      ListHeaderComponent={headerComponent}
      ListFooterComponent={footerComponent}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      showsVerticalScrollIndicator={false}
    />
  );
}

/**
 * Group jobs hierarchically: full_subject parent -> course children.
 *
 * ALGORITHM:
 * 1. Index all jobs by ID for O(1) parent lookup
 * 2. Iterate jobs; if job.parentJobId points to a full_subject, nest it
 * 3. Otherwise, create top-level group with empty children array
 * 4. In final pass, populate children for each parent
 *
 * INVARIANT: All jobs appear exactly once (either top-level or nested)
 */
function buildJobGroups(jobs: ContentJob[]): JobGroup[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const childJobsByParentId = new Map<string, ContentJob[]>();
  const groupedJobs: JobGroup[] = [];

  jobs.forEach((job) => {
    const parentJobId = String(job.parentJobId || '').trim();
    const parentJob = parentJobId ? jobsById.get(parentJobId) : undefined;
    const shouldNestUnderParent =
      Boolean(parentJob) &&
      parentJob?.contentType === 'full_subject' &&
      job.contentType === 'course';

    if (shouldNestUnderParent) {
      const existingChildren = childJobsByParentId.get(parentJobId) || [];
      existingChildren.push(job);
      childJobsByParentId.set(parentJobId, existingChildren);
      return;
    }

    groupedJobs.push({
      parentJob: job,
      childJobs: [],
    });
  });

  return groupedJobs.map((group) => ({
    ...group,
    childJobs: childJobsByParentId.get(group.parentJob.id) || [],
  }));
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    emptyText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 18,
      color: theme.colors.text,
    },
    emptySubtext: {
      fontFamily: 'DMSans-Regular',
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    list: {
      paddingBottom: 100,
    },
    jobGroup: {
      gap: 8,
    },
    jobItem: {
      marginHorizontal: 16,
    },
    childJobs: {
      gap: 8,
    },
    childJobItem: {
      marginLeft: 40,
      paddingLeft: 12,
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.border,
    },
  });
