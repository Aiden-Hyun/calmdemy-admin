/**
 * ARCHITECTURAL ROLE:
 * Custom hook encapsulating all regeneration/thumbnail job-watching logic for the content manager.
 * Extracted from ContentManagerScreen to enforce single responsibility principle.
 *
 * DESIGN PATTERNS:
 * - **State Management**: Tracks regeneration status per content item via Map-based state
 * - **Subscription Management**: Creates and cleans up Firestore listeners (subscriptions) per job
 * - **Timer Management**: Handles auto-dismiss timers for success/error states
 * - **Cleanup Lifecycle**: useEffect ensures all subscriptions and timers are cleaned up on unmount
 *
 * RESPONSIBILITIES:
 * - regenStatus state: Track job status (pending, generating, completed, failed, unsupported, etc.)
 * - submittingIds state: Track which items are currently submitting regeneration requests
 * - Firestore subscriptions: Listen for job status updates in real-time
 * - Auto-dismiss logic: Hide status pills after configurable timeout
 * - Error handling: Gracefully handle regeneration request failures
 *
 * CONSUMERS:
 * - ContentManagerScreen: Uses returned state and handlers to manage regeneration UI
 *
 * @returns Object containing regeneration state and handler callbacks
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Unsubscribe } from 'firebase/firestore';
import {
  createThumbnailOnlyJob,
  getLatestCompletedCourseJobForCourseId,
  getLatestCompletedJobForContentId,
  requestContentThumbnailGeneration,
  requestCourseThumbnailGeneration,
  subscribeToJob,
} from '@features/admin/data/adminRepository';
import { JOB_STATUS_LABELS, JobStatus } from '@features/admin/types';
import { ContentManagerItemSummary } from '../types';

export interface RegenerationStatus {
  jobId?: string;
  status: JobStatus | 'no_job' | 'error' | 'unsupported';
  label: string;
  completedAt?: string;
}

export interface UseContentRegenerationReturn {
  regenStatus: Map<string, RegenerationStatus>;
  submittingIds: Set<string>;
  handleRegenerate: (item: ContentManagerItemSummary) => Promise<void>;
}

/**
 * Regeneration hook managing job submission, status tracking, and Firestore subscriptions.
 *
 * STATE OVERVIEW:
 * - regenStatus: Map<contentId, {jobId, status, label, completedAt}>
 *   Tracks the current regeneration state for each item (pending/generating/completed/error)
 * - submittingIds: Set<contentId>
 *   Tracks which items are currently submitting regeneration requests
 * - unsubscribesRef: Map<contentId, Unsubscribe>
 *   Stores Firestore listener unsubscribe functions for cleanup
 * - dismissTimersRef: Map<contentId, timeoutId>
 *   Stores auto-dismiss timeout IDs for cleanup
 *
 * LIFECYCLE:
 * - On mount: Initialize empty state
 * - On unmount: Unsubscribe all Firestore listeners and clear all timers
 * - On handleRegenerate: Create job, start watching, set auto-dismiss timer
 * - On job completion: Auto-dismiss after 15 seconds
 * - On error: Set error status and auto-dismiss after 8 seconds
 *
 * @returns Object with regenStatus, submittingIds, and handleRegenerate callback
 */
export function useContentRegeneration(): UseContentRegenerationReturn {
  // Track regeneration status per content item
  const [regenStatus, setRegenStatus] = useState<Map<string, RegenerationStatus>>(new Map());
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const unsubscribesRef = useRef<Map<string, Unsubscribe>>(new Map());
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up all subscriptions and timers on unmount
  useEffect(() => {
    return () => {
      for (const unsub of unsubscribesRef.current.values()) unsub();
      for (const timer of dismissTimersRef.current.values()) clearTimeout(timer);
    };
  }, []);

  /**
   * Set status and schedule auto-dismiss. Clears any existing subscription/timer for this content item.
   *
   * @param contentId - The content item ID
   * @param entry - Status entry with jobId, status, label, and optional completedAt
   *
   * SIDE EFFECTS:
   * - Unsubscribes from any existing Firestore listener for this contentId
   * - Clears any existing auto-dismiss timer
   * - Sets new status in regenStatus state
   * - Schedules auto-dismiss after 8 seconds (for error/unsupported states)
   */
  const setStatusWithAutoDismiss = useCallback(
    (
      contentId: string,
      entry: Omit<RegenerationStatus, 'status'> & {
        status: 'no_job' | 'error' | 'unsupported';
      }
    ) => {
      // Clear any existing subscription/timer
      unsubscribesRef.current.get(contentId)?.();
      unsubscribesRef.current.delete(contentId);
      const existingTimer = dismissTimersRef.current.get(contentId);
      if (existingTimer) clearTimeout(existingTimer);

      setRegenStatus((prev) => {
        const next = new Map(prev);
        next.set(contentId, entry);
        return next;
      });

      const timer = setTimeout(() => {
        setRegenStatus((prev) => {
          const next = new Map(prev);
          next.delete(contentId);
          return next;
        });
        dismissTimersRef.current.delete(contentId);
      }, 8_000);
      dismissTimersRef.current.set(contentId, timer);
    },
    []
  );

  /**
   * Subscribe to job status updates and track status transitions.
   *
   * Creates a Firestore listener for the job and updates regenStatus as job progresses.
   * When job reaches terminal state (completed/failed), unsubscribes and schedules auto-dismiss.
   *
   * @param contentId - The content item ID (used as key in state maps)
   * @param jobId - The Firestore job document ID
   *
   * SIDE EFFECTS:
   * - Cancels existing subscription/timer for this contentId
   * - Creates new Firestore listener via subscribeToJob()
   * - Sets initial status to 'Queued'
   * - Updates status map as job progresses
   * - Auto-dismisses after 15 seconds when terminal state reached
   */
  const startWatchingJob = useCallback((contentId: string, jobId: string) => {
    // Cancel any existing subscription for this content item
    unsubscribesRef.current.get(contentId)?.();
    const existingTimer = dismissTimersRef.current.get(contentId);
    if (existingTimer) clearTimeout(existingTimer);

    setRegenStatus((prev) => {
      const next = new Map(prev);
      next.set(contentId, { jobId, status: 'pending', label: 'Queued' });
      return next;
    });

    const unsub = subscribeToJob(jobId, (updatedJob) => {
      if (!updatedJob) return;

      const status = updatedJob.status;
      const isTerminal = status === 'completed' || status === 'failed';
      let completedAt: string | undefined;

      if (status === 'completed' && updatedJob.runEndedAt?.toDate) {
        completedAt = updatedJob.runEndedAt.toDate().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        });
      }

      const label =
        status === 'completed' && completedAt
          ? `Finished at ${completedAt}`
          : status === 'failed'
            ? updatedJob.error || 'Failed'
            : status === 'pending'
              ? 'Queued'
              : JOB_STATUS_LABELS[status] || status;

      setRegenStatus((prev) => {
        const next = new Map(prev);
        next.set(contentId, { jobId, status, label, completedAt });
        return next;
      });

      if (isTerminal) {
        // Unsubscribe once terminal
        unsubscribesRef.current.get(contentId)?.();
        unsubscribesRef.current.delete(contentId);

        // Auto-dismiss after 15 seconds
        const timer = setTimeout(() => {
          setRegenStatus((prev) => {
            const next = new Map(prev);
            next.delete(contentId);
            return next;
          });
          dismissTimersRef.current.delete(contentId);
        }, 15_000);
        dismissTimersRef.current.set(contentId, timer);
      }
    });

    unsubscribesRef.current.set(contentId, unsub);
  }, []);

  /**
   * Collections that don't support thumbnail regeneration.
   * Attempting to regenerate thumbnails for these collections will show an error message.
   */
  const NO_THUMBNAIL_COLLECTIONS = [
    'course_sessions',
    'background_sounds',
    'breathing_exercises',
    'meditation_programs',
  ];

  /**
   * Main handler for regenerating thumbnails. Orchestrates the entire flow:
   * 1. Validate content type (some don't support thumbnails)
   * 2. Fetch the latest completed job for this content
   * 3. Request thumbnail generation on that job (or create new thumbnail-only job)
   * 4. Subscribe to job status updates
   * 5. Handle errors gracefully
   *
   * SIDE EFFECTS:
   * - Updates submittingIds to show loading state
   * - May create new job in Firestore
   * - May request generation on existing job
   * - Calls startWatchingJob to subscribe to updates
   * - Sets error status via setStatusWithAutoDismiss on failure
   *
   * @param item - ContentManagerItemSummary with id, collection, title, description
   *
   * ERROR CASES:
   * - Item collection is in NO_THUMBNAIL_COLLECTIONS → unsupported status
   * - No prior job found and can't fetch/create one → error status
   * - Firestore request throws → error status with error message
   */
  const handleRegenerate = useCallback(
    async (item: ContentManagerItemSummary) => {
      if (NO_THUMBNAIL_COLLECTIONS.includes(item.collection)) {
        setStatusWithAutoDismiss(item.id, {
          status: 'unsupported',
          label:
            item.collection === 'course_sessions'
              ? 'Regenerate the parent course instead'
              : 'This content type does not support thumbnails',
        });
        return;
      }

      setSubmittingIds((prev) => new Set(prev).add(item.id));
      try {
        let jobId: string;

        if (item.collection === 'courses') {
          const job = await getLatestCompletedCourseJobForCourseId(item.id);
          if (job) {
            await requestCourseThumbnailGeneration(job);
            jobId = job.id;
          } else {
            // Course with no factory job — create a thumbnail-only job
            jobId = await createThumbnailOnlyJob({
              contentId: item.id,
              collection: item.collection,
              title: item.title,
              description: item.description,
            });
          }
        } else {
          const job = await getLatestCompletedJobForContentId(item.id);
          if (job) {
            await requestContentThumbnailGeneration(job);
            jobId = job.id;
          } else {
            // Seeded content with no factory job — create a thumbnail-only job
            jobId = await createThumbnailOnlyJob({
              contentId: item.id,
              collection: item.collection,
              title: item.title,
              description: item.description,
            });
          }
        }

        startWatchingJob(item.id, jobId);
      } catch (regenerateError) {
        setStatusWithAutoDismiss(item.id, {
          status: 'error',
          label:
            regenerateError instanceof Error
              ? regenerateError.message
              : 'Failed to request regeneration',
        });
      } finally {
        setSubmittingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [startWatchingJob, setStatusWithAutoDismiss]
  );

  return {
    regenStatus,
    submittingIds,
    handleRegenerate,
  };
}
