import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  subscribeToJobs,
  subscribeToJob,
  subscribeToFactoryJob,
  subscribeToFactoryJobRun,
  subscribeToWorkerControl,
  subscribeToWorkerStatus,
  subscribeToActiveJobWorkers,
  createContentJob,
  retryJob,
  cancelJob,
  requestDeleteJob,
  regenerateCourseSessions,
  approveSubjectPlan,
  approvePendingScripts,
  pauseFullSubjectJob,
  regenerateSubjectPlan,
  regeneratePendingScripts,
  requestCourseThumbnailGeneration,
  resumeFullSubjectJob,
  subscribeToChildJobs,
  subscribeToJobStepTimeline,
  setWorkerDesiredState,
  setWorkerIdleTimeout,
} from '../data/adminRepository';
import {
  ContentJob,
  ContentDraft,
  CreateJobInput,
  FactoryJob,
  FactoryJobRun,
  JobStatus,
  JobExecutionView,
  WorkerControl,
  WorkerDesiredState,
  WorkerStatus,
  ActiveJobWorker,
  WorkerStackStatus,
  FactoryMetrics,
  WorkerLogTail,
  JobStepTimelineEntry,
  CourseRegenerationMode,
} from '../types';
import { getDrafts, deleteDraft as removeDraft } from '../data/draftRepository';
import { resolveJobExecutionView } from '../utils/jobExecutionState';
import {
  subscribeToStacksStatus,
  subscribeToFactoryMetrics,
  subscribeToWorkerLogTail,
} from '../data/adminRepository';

// ==================== JOB LIST HOOK ====================

export function useJobQueue(statusFilter?: JobStatus) {
  const [allJobs, setAllJobs] = useState<ContentJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeToJobs((updatedJobs) => {
      setAllJobs(updatedJobs);
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  const jobs = useMemo(
    () =>
      statusFilter ? allJobs.filter((job) => job.status === statusFilter) : allJobs,
    [allJobs, statusFilter]
  );

  const createJob = useCallback(async (input: CreateJobInput) => {
    return createContentJob(input);
  }, []);

  return { jobs, isLoading, createJob };
}

// ==================== SINGLE JOB HOOK ====================

export function useJobDetail(jobId: string) {
  const [job, setJob] = useState<ContentJob | null>(null);
  const [factoryJob, setFactoryJob] = useState<FactoryJob | null>(null);
  const [factoryRun, setFactoryRun] = useState<FactoryJobRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!jobId) return;

    setIsLoading(true);
    const unsubscribe = subscribeToJob(jobId, (updatedJob) => {
      setJob(updatedJob);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [jobId]);

  const factoryJobId =
    job?.engine === 'v2'
      ? String(job.v2JobId || job.id || '').trim() || undefined
      : job?.v2JobId
        ? String(job.v2JobId).trim() || undefined
        : undefined;

  useEffect(() => {
    if (!factoryJobId) {
      setFactoryJob(null);
      return;
    }

    return subscribeToFactoryJob(factoryJobId, setFactoryJob);
  }, [factoryJobId]);

  const factoryRunId =
    String(factoryJob?.currentRunId || job?.v2RunId || '').trim() || undefined;

  useEffect(() => {
    if (!factoryRunId) {
      setFactoryRun(null);
      return;
    }

    return subscribeToFactoryJobRun(factoryRunId, setFactoryRun);
  }, [factoryRunId]);

  const executionView: JobExecutionView | null = useMemo(
    () => resolveJobExecutionView(job, factoryJob, factoryRun),
    [job, factoryJob, factoryRun]
  );

  const retry = useCallback(async () => {
    if (!jobId) return;
    await retryJob(jobId);
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    await cancelJob(jobId);
  }, [jobId]);

  const requestDelete = useCallback(async () => {
    if (!jobId) return;
    await requestDeleteJob(jobId);
  }, [jobId]);

  const regenerateCourse = useCallback(
    async (input: {
      mode: CourseRegenerationMode;
      targetSessionCodes: string[];
      formattedScriptEdits?: Record<string, string>;
    }) => {
      if (!jobId || !job) return;
      await regenerateCourseSessions(job, input);
    },
    [job, jobId]
  );

  const approvePendingScriptsAction = useCallback(async (input?: {
    rawScriptEdits?: Record<string, string>;
    script?: string;
  }) => {
    if (!jobId || !job) return;
    await approvePendingScripts(job, input);
  }, [job, jobId]);

  const regeneratePendingScriptsAction = useCallback(async () => {
    if (!jobId || !job) return;
    await regeneratePendingScripts(job);
  }, [job, jobId]);

  const requestThumbnailAction = useCallback(async () => {
    if (!jobId || !job) return;
    await requestCourseThumbnailGeneration(job);
  }, [job, jobId]);

  const approveSubjectPlanAction = useCallback(async (input?: {
    courseEdits?: Record<string, { title?: string; description?: string }>;
  }) => {
    if (!jobId || !job) return;
    await approveSubjectPlan(job, input);
  }, [job, jobId]);

  const regenerateSubjectPlanAction = useCallback(async () => {
    if (!jobId || !job) return;
    await regenerateSubjectPlan(job);
  }, [job, jobId]);

  const pauseSubjectAction = useCallback(async () => {
    if (!jobId || !job) return;
    await pauseFullSubjectJob(job);
  }, [job, jobId]);

  const resumeSubjectAction = useCallback(async () => {
    if (!jobId || !job) return;
    await resumeFullSubjectJob(job);
  }, [job, jobId]);

  return {
    job,
    factoryJob,
    factoryRun,
    executionView,
    isLoading,
    retry,
    cancel,
    requestDelete,
    regenerateCourse,
    approveSubjectPlan: approveSubjectPlanAction,
    approvePendingScripts: approvePendingScriptsAction,
    pauseSubject: pauseSubjectAction,
    requestThumbnail: requestThumbnailAction,
    regenerateSubjectPlan: regenerateSubjectPlanAction,
    regeneratePendingScripts: regeneratePendingScriptsAction,
    resumeSubject: resumeSubjectAction,
  };
}

export function useChildJobs(parentJobId?: string) {
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!parentJobId) {
      setJobs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const unsubscribe = subscribeToChildJobs(parentJobId, (updatedJobs) => {
      setJobs(updatedJobs);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [parentJobId]);

  return { jobs, isLoading };
}

// ==================== STEP TIMELINE HOOK ====================

export function useJobStepTimeline(jobId: string, runId?: string) {
  const [timeline, setTimeline] = useState<JobStepTimelineEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!jobId) {
      setTimeline([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const unsubscribe = subscribeToJobStepTimeline(jobId, (entries) => {
      setTimeline(entries);
      setIsLoading(false);
    }, runId);

    return unsubscribe;
  }, [jobId, runId]);

  return { timeline, isLoading };
}

// ==================== WORKER STATUS HOOK ====================

export function useWorkerStatus(workerId: 'local') {
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToWorkerStatus(workerId, (next) => {
      setStatus(next);
    });
    return unsubscribe;
  }, [workerId]);

  return { status };
}

export function useActiveJobWorkers(jobIds?: string[]) {
  const [workersByJobId, setWorkersByJobId] = useState<Record<string, ActiveJobWorker[]>>({});
  const jobIdsKey =
    jobIds === undefined
      ? '__all__'
      : (() => {
          const normalized = jobIds
            .map((jobId) => String(jobId || '').trim())
            .filter(Boolean)
            .sort();
          return normalized.length > 0 ? normalized.join('|') : '__none__';
        })();

  useEffect(() => {
    if (jobIdsKey === '__none__') {
      setWorkersByJobId({});
      return;
    }

    const normalizedJobIds =
      jobIdsKey === '__all__' ? undefined : jobIdsKey.split('|');
    const unsubscribe = subscribeToActiveJobWorkers((next) => {
      setWorkersByJobId(next);
    }, normalizedJobIds);
    return unsubscribe;
  }, [jobIdsKey]);

  return { workersByJobId };
}

// ==================== WORKER CONTROL HOOK ====================

export function useWorkerControl(workerId: 'local') {
  const [control, setControl] = useState<WorkerControl | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToWorkerControl(workerId, (next) => {
      setControl(next);
    });
    return unsubscribe;
  }, [workerId]);

  const setDesiredState = useCallback(
    async (state: WorkerDesiredState) => {
      await setWorkerDesiredState(workerId, state);
    },
    [workerId]
  );

  const setIdleTimeout = useCallback(
    async (minutes: number) => {
      await setWorkerIdleTimeout(workerId, minutes);
    },
    [workerId]
  );

  return { control, setDesiredState, setIdleTimeout };
}

// ==================== DRAFTS HOOK ====================

export function useDrafts() {
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const next = await getDrafts();
    setDrafts(next);
    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const deleteDraft = useCallback(async (id: string) => {
    await removeDraft(id);
    await refresh();
  }, [refresh]);

  return { drafts, isLoading, refresh, deleteDraft };
}

// ==================== WORKER STACKS ====================

export function useWorkerStacks() {
  const [stacks, setStacks] = useState<WorkerStackStatus[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToStacksStatus((next) => setStacks(next));
    return unsubscribe;
  }, []);

  return { stacks };
}

// ==================== WORKER LOG TAIL ====================

export function useWorkerLogTail(stackId?: string, refreshNonce = 0) {
  const [tail, setTail] = useState<WorkerLogTail | null>(null);

  useEffect(() => {
    if (!stackId) {
      setTail(null);
      return;
    }
    const unsubscribe = subscribeToWorkerLogTail(stackId, (next) => setTail(next));
    return unsubscribe;
  }, [stackId, refreshNonce]);

  return { tail };
}

// ==================== FACTORY METRICS ====================

export function useFactoryMetrics() {
  const [metrics, setMetrics] = useState<FactoryMetrics | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToFactoryMetrics((next) => setMetrics(next));
    return unsubscribe;
  }, []);

  return { metrics };
}
