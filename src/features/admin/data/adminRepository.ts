import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  where,
  limit,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db, getCurrentUserId } from '../../../firebase';
import {
  ActiveJobWorker,
  ContentJob,
  CourseRegenerationMode,
  FactoryContentType,
  FactoryJob,
  FactoryJobRun,
  CreateJobInput,
  JobStatus,
  SubjectPlan,
  WorkerControl,
  WorkerDesiredState,
  WorkerStatus,
  WorkerStackStatus,
  FactoryMetrics,
  WorkerLogTail,
  WorkerLogEntry,
  JobStepTimelineEntry,
} from '../types';

// Re-export subject/course utilities from meditate repository
export {
  getSubjects,
  createSubject,
  checkCourseCodeExists,
} from '../../meditate/data/meditateRepository';
export type { Subject } from '../../meditate/data/meditateRepository';

const jobsCollection = collection(db, 'content_jobs');
const usersCollection = collection(db, 'users');
const workerControlCollection = collection(db, 'worker_control');
const factoryJobsCollection = collection(db, 'factory_jobs');
const factoryJobRunsCollection = collection(db, 'factory_job_runs');
const stepRunsCollection = collection(db, 'factory_step_runs');
const COURSE_SHARD_SUFFIXES = ['INT', 'M1L', 'M1P', 'M2L', 'M2P', 'M3L', 'M3P', 'M4L', 'M4P'];

function toContentJob(docId: string, data: Record<string, any>): ContentJob {
  return { id: docId, ...data } as ContentJob;
}

function asMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  return 0;
}

function sortJobsNewestFirst(jobs: ContentJob[]): ContentJob[] {
  return [...jobs].sort((left, right) => {
    const completedDiff = asMillis(right.completedAt) - asMillis(left.completedAt);
    if (completedDiff !== 0) {
      return completedDiff;
    }

    const updatedDiff = asMillis(right.updatedAt) - asMillis(left.updatedAt);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }

    return asMillis(right.createdAt) - asMillis(left.createdAt);
  });
}

async function queryCourseJobsByField(
  fieldName: 'courseId' | 'courseSessionIds',
  operator: '==' | 'array-contains',
  value: string
): Promise<ContentJob[]> {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return [];
  }

  const snapshot = await getDocs(
    query(jobsCollection, where(fieldName, operator as any, normalizedValue), limit(20))
  );

  return snapshot.docs
    .map((docSnapshot) => toContentJob(docSnapshot.id, docSnapshot.data() as Record<string, any>))
    .filter((job) => job.contentType === 'course' && job.status === 'completed');
}

function freshDispatchResetFields(
  options?: { preserveTiming?: boolean }
): Record<string, null | false | string> {
  const base: Record<string, null | false | string> = {
    jobRunId: null,
    runAttempt: null,
    runWorkerId: null,
    runWorkerRole: null,
    runStartedAt: null,
    runContinuedAt: null,
    v2RunId: null,
    v2Locked: false,
    v2DispatchError: null,
    v2DispatchedBy: null,
    v2DispatchedAt: null,
    activeRunElapsedMs: null,
  };
  if (options?.preserveTiming) {
    return base;
  }
  return {
    ...base,
    timingStatus: 'unavailable',
    effectiveElapsedMs: null,
    effectiveWorkerMs: null,
    reuseCreditMs: null,
    wastedWorkerMs: null,
    queueLatencyMs: null,
    parallelismFactor: null,
    timingComputedAt: null,
    timingVersion: null,
  };
}

function makePendingScriptApprovalPayload(userId: string | null) {
  return {
    enabled: true,
    awaitingApproval: false,
    scriptApprovedBy: null,
    scriptApprovedAt: null,
    requestedBy: userId,
    requestedAt: serverTimestamp(),
  };
}

function makePendingSubjectPlanApprovalPayload(userId: string | null) {
  return {
    enabled: true,
    awaitingApproval: false,
    approvedBy: null,
    approvedAt: null,
    requestedBy: userId,
    requestedAt: serverTimestamp(),
  };
}

function cloneSubjectPlan(plan: SubjectPlan): SubjectPlan {
  return {
    ...plan,
    courses: Array.isArray(plan.courses)
      ? plan.courses.map((course) => ({
          ...course,
          learningGoals: Array.isArray(course.learningGoals) ? [...course.learningGoals] : undefined,
          prerequisites: Array.isArray(course.prerequisites) ? [...course.prerequisites] : undefined,
        }))
      : [],
  };
}

function emptySubjectChildCounts() {
  return {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
}

function normalizeJobStatus(value: unknown): JobStatus | undefined {
  const status = String(value || '').trim().toLowerCase();
  switch (status) {
    case 'pending':
    case 'llm_generating':
    case 'qa_formatting':
    case 'image_generating':
    case 'tts_pending':
    case 'tts_converting':
    case 'post_processing':
    case 'uploading':
    case 'publishing':
    case 'paused':
    case 'completed':
    case 'failed':
      return status;
    default:
      return undefined;
  }
}

function toFactoryJob(docId: string, data: Record<string, any>): FactoryJob {
  const summary = data.summary as Record<string, any> | undefined;
  return {
    id: docId,
    jobType: data.job_type,
    currentState: data.current_state,
    currentRunId: data.current_run_id,
    summary: summary
      ? {
          currentStep: summary.currentStep,
          lastRunStatus: summary.lastRunStatus,
          lastRunId: summary.lastRunId,
          failedStep: summary.failedStep,
          errorCode: summary.errorCode,
          subjectState: summary.subjectState,
          launchCursor: summary.launchCursor,
        }
      : undefined,
    runtime: data.runtime,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

function toFactoryJobRun(docId: string, data: Record<string, any>): FactoryJobRun {
  return {
    id: docId,
    jobId: data.job_id,
    runNumber: data.run_number,
    state: data.state,
    trigger: data.trigger,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    failedStep: data.failed_step,
    errorCode: data.error_code,
    updatedAt: data.updated_at,
  };
}

function courseCodeForJob(job: Pick<ContentJob, 'params'> | Record<string, any>): string {
  return String((job.params || {}).courseCode || '').trim().toUpperCase();
}

function childUpdatedAtMs(job: Pick<ContentJob, 'updatedAt' | 'completedAt' | 'createdAt'>): number {
  return (
    job.updatedAt?.toDate?.().getTime?.() ||
    job.completedAt?.toDate?.().getTime?.() ||
    job.createdAt?.toDate?.().getTime?.() ||
    0
  );
}

function pickReusableSubjectChildren(
  job: ContentJob,
  childJobs: ContentJob[]
): {
  reusableChildIds: string[];
  detachedChildIds: string[];
  nextPlan: SubjectPlan | undefined;
  nextCounts: { pending: number; running: number; completed: number; failed: number };
} {
  const subjectPlan = job.subjectPlan ? cloneSubjectPlan(job.subjectPlan) : undefined;
  if (!subjectPlan) {
    return {
      reusableChildIds: [],
      detachedChildIds: childJobs.map((child) => child.id),
      nextPlan: undefined,
      nextCounts: emptySubjectChildCounts(),
    };
  }

  const completedByCode = new Map<string, ContentJob[]>();
  childJobs.forEach((childJob) => {
    if (normalizeJobStatus(childJob.status) !== 'completed') return;
    const courseCode = courseCodeForJob(childJob);
    if (!courseCode) return;
    const current = completedByCode.get(courseCode) || [];
    current.push(childJob);
    completedByCode.set(courseCode, current);
  });
  completedByCode.forEach((jobsForCode) => {
    jobsForCode.sort((left, right) => childUpdatedAtMs(right) - childUpdatedAtMs(left));
  });

  const selectedChildIds = new Set<string>();
  const reusableChildIds: string[] = [];

  subjectPlan.courses = subjectPlan.courses.map((course) => {
    const courseCode = String(course.code || '').trim().toUpperCase();
    const candidates = completedByCode.get(courseCode) || [];
    const preferredChildId = String(course.childJobId || '').trim();
    const { childJobId: _previousChildJobId, childStatus: _previousChildStatus, childError: _previousChildError, ...restCourse } = course;
    let selectedChild =
      (preferredChildId
        ? candidates.find((candidate) => candidate.id === preferredChildId)
        : undefined) ||
      candidates.find((candidate) => !selectedChildIds.has(candidate.id));

    if (!selectedChild) {
      return restCourse;
    }

    selectedChildIds.add(selectedChild.id);
    reusableChildIds.push(selectedChild.id);
    return {
      ...restCourse,
      childJobId: selectedChild.id,
      childStatus: 'completed' as JobStatus,
    };
  });

  return {
    reusableChildIds,
    detachedChildIds: childJobs
      .map((child) => child.id)
      .filter((childId) => !selectedChildIds.has(childId)),
    nextPlan: subjectPlan,
    nextCounts: {
      ...emptySubjectChildCounts(),
      completed: reusableChildIds.length,
    },
  };
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asTimestamp(value: unknown): Timestamp | undefined {
  if (value instanceof Timestamp) return value;
  return undefined;
}

function isFreshWorkerHeartbeat(status: WorkerStatus, nowMs = Date.now()): boolean {
  const lastHeartbeatMs = status.lastHeartbeat?.toDate?.().getTime();
  if (!lastHeartbeatMs) {
    return false;
  }

  const pollIntervalSec =
    typeof status.pollIntervalSec === 'number' && Number.isFinite(status.pollIntervalSec)
      ? status.pollIntervalSec
      : 10;
  const maxAgeMs = Math.max(45_000, pollIntervalSec * 6_000);
  return nowMs - lastHeartbeatMs <= maxAgeMs;
}

function toActiveJobWorker(status: WorkerStatus): ActiveJobWorker | null {
  const jobId = String(status.jobId || '').trim();
  const workerId = String(status.workerId || status.id || '').trim();
  const stackId = String(status.stackId || workerId).trim();
  const currentQueueId = String(status.currentQueueId || '').trim();

  if (!jobId || !workerId || !stackId || !currentQueueId) {
    return null;
  }

  if (!isFreshWorkerHeartbeat(status)) {
    return null;
  }

  return {
    workerId,
    stackId,
    jobId,
    currentQueueId,
    currentRunId: String(status.currentRunId || '').trim() || undefined,
    currentStepName: String(status.currentStepName || '').trim() || undefined,
    currentShardKey: String(status.currentShardKey || '').trim() || undefined,
    currentProgressDetail: String(status.currentProgressDetail || '').trim() || undefined,
    currentRequiredTtsModel: String(status.currentRequiredTtsModel || '').trim() || undefined,
    lastHeartbeat: status.lastHeartbeat,
  };
}

function toV2TimelineEntry(id: string, data: Record<string, any>): JobStepTimelineEntry {
  return {
    id,
    source: 'v2',
    jobId: String(data.job_id || ''),
    runId: data.run_id ? String(data.run_id) : undefined,
    stepName: String(data.step_name || 'unknown'),
    shardKey: data.shard_key ? String(data.shard_key) : undefined,
    workerId: data.worker_id ? String(data.worker_id) : undefined,
    queueId: data.queue_id ? String(data.queue_id) : undefined,
    state: String(data.state || 'unknown'),
    attempt: parseNumber(data.attempt),
    nextAttempt: parseNumber(data.next_attempt),
    retryDelaySec: parseNumber(data.retry_delay_seconds),
    errorCode: data.error_code ? String(data.error_code) : undefined,
    errorMessage: data.error_message ? String(data.error_message) : undefined,
    startedAt: asTimestamp(data.started_at),
    endedAt: asTimestamp(data.ended_at),
    updatedAt: asTimestamp(data.updated_at),
    timestamp:
      asTimestamp(data.ended_at) ||
      asTimestamp(data.updated_at) ||
      asTimestamp(data.started_at) ||
      asTimestamp(data.created_at),
  };
}

// ==================== ADMIN CHECK ====================

export async function checkIsAdmin(uid: string): Promise<boolean> {
  try {
    const userDoc = await getDoc(doc(usersCollection, uid));
    if (!userDoc.exists()) return false;
    return userDoc.data()?.role === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// ==================== CREATE JOB ====================

export async function createContentJob(input: CreateJobInput): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');

  // Strip undefined values from params — Firestore rejects undefined in nested objects
  const cleanParams = Object.fromEntries(
    Object.entries(input.params).filter(([, v]) => v !== undefined)
  );

  const jobData: Record<string, any> = {
    status: 'pending' as JobStatus,
    llmBackend: input.llmBackend,
    ttsBackend: input.ttsBackend,
    contentType: input.contentType,
    params: cleanParams,
    llmModel: input.llmModel,
    ttsModel: input.ttsModel,
    ttsVoice: input.ttsVoice,
    autoPublish: input.autoPublish,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: userId,
    timingStatus: 'unavailable',
    effectiveElapsedMs: null,
    effectiveWorkerMs: null,
    reuseCreditMs: null,
    wastedWorkerMs: null,
    queueLatencyMs: null,
    parallelismFactor: null,
    timingComputedAt: null,
    timingVersion: null,
    activeRunElapsedMs: null,
  };

  // Only store title if admin provided one
  if (input.title?.trim()) {
    jobData.title = input.title.trim();
  }
  if (input.imagePrompt?.trim()) {
    jobData.imagePrompt = input.imagePrompt.trim();
  }

  // Course jobs get extra tracking fields
  if (input.contentType === 'course') {
    jobData.courseProgress = 'Pending';
    if (typeof input.generateThumbnailDuringRun === 'boolean') {
      jobData.generateThumbnailDuringRun = input.generateThumbnailDuringRun;
    }
    if (input.requireScriptApprovalBeforeTts) {
      jobData.courseScriptApproval = makePendingScriptApprovalPayload(userId);
    }
  } else if (input.contentType === 'full_subject') {
    jobData.autoPublish = true;
    jobData.subjectProgress = 'Pending subject curriculum generation';
    jobData.childJobIds = [];
    jobData.childCounts = emptySubjectChildCounts();
    jobData.launchCursor = 0;
    jobData.maxActiveChildCourses = 2;
    jobData.pauseRequested = false;
    if (input.requireSubjectPlanApproval) {
      jobData.subjectPlanApproval = makePendingSubjectPlanApprovalPayload(userId);
    }
  } else if (input.requireScriptApprovalBeforeTts) {
    jobData.scriptApproval = makePendingScriptApprovalPayload(userId);
  }

  const docRef = await addDoc(jobsCollection, jobData);
  return docRef.id;
}

// ==================== GET JOBS ====================

export async function getContentJobs(
  statusFilter?: JobStatus,
  maxLimit = 50
): Promise<ContentJob[]> {
  try {
    let q;
    if (statusFilter) {
      q = query(
        jobsCollection,
        where('status', '==', statusFilter),
        orderBy('createdAt', 'desc'),
        limit(maxLimit)
      );
    } else {
      q = query(
        jobsCollection,
        orderBy('createdAt', 'desc'),
        limit(maxLimit)
      );
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data() as Record<string, any>;
      return toContentJob(docSnapshot.id, data);
    });
  } catch (error) {
    console.error('Error fetching content jobs:', error);
    return [];
  }
}

// ==================== GET SINGLE JOB ====================

export async function getContentJob(jobId: string): Promise<ContentJob | null> {
  try {
    const docSnapshot = await getDoc(doc(jobsCollection, jobId));
    if (!docSnapshot.exists()) return null;
    const data = docSnapshot.data() as Record<string, any>;
    return toContentJob(docSnapshot.id, data);
  } catch (error) {
    console.error('Error fetching content job:', error);
    return null;
  }
}

export async function getLatestCompletedCourseJobForCourseId(
  courseId: string
): Promise<ContentJob | null> {
  try {
    const jobs = await queryCourseJobsByField('courseId', '==', courseId);
    return sortJobsNewestFirst(jobs)[0] || null;
  } catch (error) {
    console.error('Error fetching latest completed course job by course id:', error);
    return null;
  }
}

export async function getLatestCompletedCourseJobForCourseSessionId(
  sessionId: string,
  fallbackCourseId?: string
): Promise<ContentJob | null> {
  try {
    const bySession = sortJobsNewestFirst(
      await queryCourseJobsByField('courseSessionIds', 'array-contains', sessionId)
    )[0];
    if (bySession) {
      return bySession;
    }

    if (!fallbackCourseId) {
      return null;
    }

    return await getLatestCompletedCourseJobForCourseId(fallbackCourseId);
  } catch (error) {
    console.error('Error fetching latest completed course job by course session id:', error);
    return null;
  }
}

// ==================== REAL-TIME LISTENERS ====================

export function subscribeToJobs(
  callback: (jobs: ContentJob[]) => void,
  statusFilter?: JobStatus
): Unsubscribe {
  let q;
  if (statusFilter) {
    q = query(
      jobsCollection,
      where('status', '==', statusFilter),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  } else {
    q = query(jobsCollection, orderBy('createdAt', 'desc'), limit(50));
  }

  return onSnapshot(q, (snapshot) => {
    const jobs = snapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data() as Record<string, any>;
      return toContentJob(docSnapshot.id, data);
    });
    callback(jobs);
  });
}

export function subscribeToJob(
  jobId: string,
  callback: (job: ContentJob | null) => void
): Unsubscribe {
  return onSnapshot(doc(jobsCollection, jobId), (docSnapshot) => {
    if (!docSnapshot.exists()) {
      callback(null);
      return;
    }
    const data = docSnapshot.data() as Record<string, any>;
    callback(toContentJob(docSnapshot.id, data));
  });
}

export function subscribeToFactoryJob(
  jobId: string | undefined,
  callback: (job: FactoryJob | null) => void
): Unsubscribe {
  if (!jobId) {
    callback(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(factoryJobsCollection, jobId),
    (docSnapshot) => {
      if (!docSnapshot.exists()) {
        callback(null);
        return;
      }
      callback(toFactoryJob(docSnapshot.id, docSnapshot.data() as Record<string, any>));
    },
    (error) => {
      console.warn('Error subscribing to factory job:', error);
      callback(null);
    }
  );
}

export function subscribeToFactoryJobRun(
  runId: string | undefined,
  callback: (run: FactoryJobRun | null) => void
): Unsubscribe {
  if (!runId) {
    callback(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(factoryJobRunsCollection, runId),
    (docSnapshot) => {
      if (!docSnapshot.exists()) {
        callback(null);
        return;
      }
      callback(toFactoryJobRun(docSnapshot.id, docSnapshot.data() as Record<string, any>));
    },
    (error) => {
      console.warn('Error subscribing to factory job run:', error);
      callback(null);
    }
  );
}

export function subscribeToChildJobs(
  parentJobId: string,
  callback: (jobs: ContentJob[]) => void
): Unsubscribe {
  if (!parentJobId) {
    callback([]);
    return () => {};
  }

  const q = query(
    jobsCollection,
    where('parentJobId', '==', parentJobId),
    orderBy('createdAt', 'asc'),
    limit(100)
  );

  return onSnapshot(q, (snapshot) => {
    const jobs = snapshot.docs.map((docSnapshot) => {
      const data = docSnapshot.data() as Record<string, any>;
      return toContentJob(docSnapshot.id, data);
    });
    callback(jobs);
  });
}

export function subscribeToJobStepTimeline(
  jobId: string,
  callback: (entries: JobStepTimelineEntry[]) => void,
  runId?: string
): Unsubscribe {
  if (!jobId) {
    callback([]);
    return () => undefined;
  }

  let v2Entries: JobStepTimelineEntry[] = [];

  const handleTimelineError = (error: unknown) => {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (code === 'permission-denied') {
      // Timeline is optional. If rules block this collection, keep detail screen usable.
      if (__DEV__) {
        console.log('[timeline] v2 step timeline unavailable (permission denied)');
      }
      return;
    }
    console.warn('Error subscribing to v2 step timeline:', error);
  };

  const emit = () => {
    const map = new Map<string, JobStepTimelineEntry>();
    const filteredEntries = runId
      ? v2Entries.filter((entry) => entry.runId === runId)
      : v2Entries;
    filteredEntries.forEach((entry) => {
      map.set(entry.id, entry);
    });

    const merged = Array.from(map.values()).sort((a, b) => {
      const aMillis = a.timestamp?.toMillis?.() || 0;
      const bMillis = b.timestamp?.toMillis?.() || 0;
      return bMillis - aMillis;
    });
    callback(merged);
  };

  const v2Query = query(
    stepRunsCollection,
    where('job_id', '==', jobId),
    limit(200)
  );

  const unsubscribeV2 = onSnapshot(
    v2Query,
    (snapshot) => {
      v2Entries = snapshot.docs.map((docSnapshot) =>
        toV2TimelineEntry(docSnapshot.id, docSnapshot.data() as Record<string, any>)
      );
      emit();
    },
    (error) => {
      handleTimelineError(error);
      v2Entries = [];
      emit();
    }
  );

  return () => {
    unsubscribeV2();
  };
}

// ==================== WORKER STATUS ====================

export function subscribeToWorkerStatus(
  workerId: 'local',
  callback: (status: WorkerStatus | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, 'worker_status', workerId), (docSnapshot) => {
    if (!docSnapshot.exists()) {
      callback(null);
      return;
    }
    callback({ id: docSnapshot.id, ...docSnapshot.data() } as WorkerStatus);
  });
}

export function subscribeToActiveJobWorkers(
  callback: (workersByJobId: Record<string, ActiveJobWorker[]>) => void,
  jobIds?: string[]
): Unsubscribe {
  let isMounted = true;
  const normalizedJobIds = new Set(
    (jobIds || []).map((jobId) => String(jobId || '').trim()).filter(Boolean)
  );

  const unsubscribe = onSnapshot(query(collection(db, 'worker_status'), limit(200)), (snapshot) => {
    if (!isMounted) return;
    const nextWorkersByJobId: Record<string, ActiveJobWorker[]> = {};

    snapshot.docs.forEach((docSnapshot) => {
      const status = { id: docSnapshot.id, ...docSnapshot.data() } as WorkerStatus;
      const activeWorker = toActiveJobWorker(status);
      if (!activeWorker) {
        return;
      }
      if (normalizedJobIds.size > 0 && !normalizedJobIds.has(activeWorker.jobId)) {
        return;
      }

      const existing = nextWorkersByJobId[activeWorker.jobId] || [];
      existing.push(activeWorker);
      nextWorkersByJobId[activeWorker.jobId] = existing;
    });

    Object.values(nextWorkersByJobId).forEach((workers) => {
      workers.sort((a, b) => a.stackId.localeCompare(b.stackId));
    });

    callback(nextWorkersByJobId);
  });

  return () => {
    isMounted = false;
    unsubscribe();
  };
}

// ==================== WORKER STACKS STATUS ====================

export function subscribeToStacksStatus(
  callback: (stacks: WorkerStackStatus[]) => void
): Unsubscribe {
  let isMounted = true;
  const stacksDoc = doc(db, 'worker_stacks_status', 'local');
  const unsubscribe = onSnapshot(stacksDoc, (docSnapshot) => {
    if (!isMounted) return;
    if (!docSnapshot.exists()) {
      callback([]);
      return;
    }
    const data = docSnapshot.data() as Record<string, any>;
    const stacks = (data.stacks || []) as any[];
    const mapped: WorkerStackStatus[] = stacks.map((s: Record<string, any>) => ({
      id: String(s.id || 'unknown'),
      role: s.role,
      venv: s.venv,
      enabled: s.enabled,
      dispatch: s.dispatch,
      acceptNonTtsSteps: s.acceptNonTtsSteps,
      ttsModels: Array.isArray(s.ttsModels) ? s.ttsModels.map((m: unknown) => String(m)) : [],
      pid: s.pid,
      logPath: s.logPath,
      lastUpdatedAt: s.lastUpdatedAt,
    }));
    callback(mapped);
  });

  return () => {
    isMounted = false;
    unsubscribe();
  };
}

// ==================== WORKER LOG TAILS ====================

export function subscribeToWorkerLogTail(
  stackId: string,
  callback: (tail: WorkerLogTail | null) => void
): Unsubscribe {
  if (!stackId) {
    callback(null);
    return () => undefined;
  }

  let isMounted = true;
  const tailDoc = doc(db, 'worker_log_tails', stackId);
  const unsubscribe = onSnapshot(tailDoc, (docSnapshot) => {
    if (!isMounted) return;
    if (!docSnapshot.exists()) {
      callback(null);
      return;
    }
    const data = docSnapshot.data() as Record<string, any>;
    const linesRaw = Array.isArray(data.lines) ? data.lines : [];
    const lines: WorkerLogEntry[] = linesRaw.map((line: Record<string, any>) => ({
      timestamp: line.timestamp,
      level: line.level,
      logger: line.logger,
      message: String(line.message || ''),
      raw: line.raw,
      job_id: line.job_id,
      stage: line.stage,
      content_type: line.content_type,
      model_id: line.model_id,
      error: line.error,
    }));
    callback({
      id: docSnapshot.id,
      stackId: String(data.stackId || docSnapshot.id),
      stackRole: data.stackRole,
      pid: data.pid ?? null,
      source: data.source,
      lineCount: data.lineCount,
      lines,
      updatedAt: data.updatedAt,
    } as WorkerLogTail);
  });

  return () => {
    isMounted = false;
    unsubscribe();
  };
}

// ==================== WORKER CONTROL ====================

export function subscribeToWorkerControl(
  workerId: 'local',
  callback: (control: WorkerControl | null) => void
): Unsubscribe {
  let isMounted = true;
  const unsubscribe = onSnapshot(doc(workerControlCollection, workerId), (docSnapshot) => {
    if (!isMounted) return;
    if (!docSnapshot.exists()) {
      callback(null);
      return;
    }
    callback({ id: docSnapshot.id, ...docSnapshot.data() } as WorkerControl);
  });

  return () => {
    isMounted = false;
    unsubscribe();
  };
}

export async function setWorkerDesiredState(
  workerId: 'local',
  desiredState: WorkerDesiredState
): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');

  await setDoc(
    doc(workerControlCollection, workerId),
    {
      desiredState,
      requestedBy: userId,
      requestedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function setWorkerIdleTimeout(
  workerId: 'local',
  idleTimeoutMin: number
): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');

  await setDoc(
    doc(workerControlCollection, workerId),
    {
      idleTimeoutMin,
      requestedBy: userId,
      requestedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// ==================== RETRY JOB ====================

export async function retryJob(jobId: string): Promise<void> {
  const jobRef = doc(jobsCollection, jobId);
  const jobSnapshot = await getDoc(jobRef);
  if (!jobSnapshot.exists()) {
    throw new Error('Job not found.');
  }

  const job = toContentJob(jobSnapshot.id, jobSnapshot.data() as Record<string, any>);
  const basePatch = {
    status: 'pending' as JobStatus,
    error: null,
    errorCode: null,
    updatedAt: serverTimestamp(),
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    failedStage: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    ...freshDispatchResetFields(),
  };

  if (job.contentType !== 'full_subject') {
    await updateDoc(jobRef, basePatch);
    return;
  }

  const childSnapshot = await getDocs(query(jobsCollection, where('parentJobId', '==', jobId)));
  const childJobs = childSnapshot.docs.map(
    (docSnapshot) => toContentJob(docSnapshot.id, docSnapshot.data() as Record<string, any>)
  );
  const { reusableChildIds, detachedChildIds, nextPlan, nextCounts } = pickReusableSubjectChildren(
    job,
    childJobs
  );

  const batch = writeBatch(db);
  detachedChildIds.forEach((childJobId) => {
    batch.update(doc(jobsCollection, childJobId), {
      parentJobId: null,
      retrySupersededParentJobId: jobId,
      retrySupersededAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  const preservedCount = reusableChildIds.length;
  const totalCourses = nextPlan?.courses.length || 0;
  const remainingCount = Math.max(0, totalCourses - preservedCount);
  const subjectProgress =
    preservedCount > 0
      ? `Retrying ${remainingCount} remaining child course${remainingCount === 1 ? '' : 's'} • preserving ${preservedCount} completed`
      : 'Retrying child course generation from the approved lineup';

  batch.update(jobRef, {
    ...basePatch,
    pauseRequested: false,
    pausedAt: null,
    subjectPlan: nextPlan || null,
    subjectProgress,
    childJobIds: reusableChildIds,
    childCounts: nextCounts,
    launchCursor: 0,
  });
  await batch.commit();
}

export interface RegenerateCourseSessionsInput {
  mode: CourseRegenerationMode;
  targetSessionCodes: string[];
  formattedScriptEdits?: Record<string, string>;
}

function validateCourseSessionCodes(codes: string[]): string[] {
  const result: string[] = [];
  for (const rawCode of codes) {
    const code = String(rawCode || '').trim();
    if (!code) continue;
    const upper = code.toUpperCase();
    if (!COURSE_SHARD_SUFFIXES.some((suffix) => upper.endsWith(suffix))) continue;
    if (!result.includes(code)) result.push(code);
  }
  return result;
}

function getInitialCourseSessionCodes(job: ContentJob): string[] {
  const courseCode = String(job.params.courseCode || '').trim();
  if (courseCode) {
    return COURSE_SHARD_SUFFIXES.map((suffix) => `${courseCode}${suffix}`);
  }

  return validateCourseSessionCodes([
    ...Object.keys(job.courseRawScripts || {}),
    ...Object.keys(job.courseFormattedScripts || {}),
  ]);
}

export async function regenerateCourseSessions(
  job: ContentJob,
  input: RegenerateCourseSessionsInput
): Promise<void> {
  if (job.contentType !== 'course') {
    throw new Error('Session regeneration is only supported for course jobs.');
  }
  if (job.status !== 'completed') {
    throw new Error('Session regeneration is only available for completed jobs.');
  }

  const mode = input.mode;
  const targetSessionCodes = validateCourseSessionCodes(input.targetSessionCodes || []);
  if (targetSessionCodes.length === 0) {
    throw new Error('Select at least one session to regenerate.');
  }

  const nextAudioResults: Record<string, { storagePath: string; durationSec: number }> = {
    ...(job.courseAudioResults || {}),
  };
  const nextRawScripts: Record<string, string> = { ...(job.courseRawScripts || {}) };
  const nextFormattedScripts: Record<string, string> = { ...(job.courseFormattedScripts || {}) };
  const edits = input.formattedScriptEdits || {};
  const previousAudioBySession: Record<string, string> = {};

  for (const sessionCode of targetSessionCodes) {
    const oldAudioPath = String(nextAudioResults[sessionCode]?.storagePath || '').trim();
    if (oldAudioPath) {
      previousAudioBySession[sessionCode] = oldAudioPath;
    }
    delete nextAudioResults[sessionCode];

    if (mode === 'script_and_audio') {
      delete nextRawScripts[sessionCode];
      delete nextFormattedScripts[sessionCode];
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(edits, sessionCode)) {
      const edited = String(edits[sessionCode] || '').trim();
      if (!edited) {
        throw new Error(`Script cannot be empty for ${sessionCode}.`);
      }
      nextFormattedScripts[sessionCode] = edited;
    }

    const formatted = String(nextFormattedScripts[sessionCode] || '').trim();
    if (!formatted) {
      throw new Error(`Missing formatted script for ${sessionCode}.`);
    }
  }

  const userId = getCurrentUserId();
  const requiresPublishApproval = Boolean(job.courseId);
  const payload: Record<string, any> = {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    courseAudioResults: nextAudioResults,
    courseFormattedScripts: nextFormattedScripts,
    ...freshDispatchResetFields(),
    courseRegeneration: {
      active: true,
      mode,
      targetSessionCodes,
      requiresPublishApproval,
      awaitingScriptApproval: false,
      scriptApprovedBy: null,
      scriptApprovedAt: null,
      previousAudioBySession,
      requestedBy: userId || null,
      requestedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  };
  if (mode === 'script_and_audio') {
    payload.courseRawScripts = nextRawScripts;
  }

  await updateDoc(doc(jobsCollection, job.id), payload);
}

export async function approvePendingScripts(
  job: ContentJob,
  input?: {
    rawScriptEdits?: Record<string, string>;
    script?: string;
  }
): Promise<void> {
  if (job.contentType !== 'course') {
    const scriptApproval = job.scriptApproval;
    if (
      job.status !== 'completed' ||
      !scriptApproval?.enabled ||
      !scriptApproval.awaitingApproval
    ) {
      throw new Error('There is no script awaiting approval for this job.');
    }

    const nextScript = String(input?.script ?? job.generatedScript ?? '').trim();
    if (!nextScript) {
      throw new Error('Script cannot be empty.');
    }

    const userId = getCurrentUserId();
    await updateDoc(doc(jobsCollection, job.id), {
      status: 'pending',
      error: null,
      errorCode: null,
      failedStage: null,
      startedAt: null,
      completedAt: null,
      runEndedAt: null,
      lastRunStatus: null,
      publishInProgress: false,
      publishLeaseOwner: null,
      publishLeaseExpiresAt: null,
      generatedScript: nextScript,
      formattedScript: null,
      ...freshDispatchResetFields(),
      scriptApproval: {
        ...scriptApproval,
        awaitingApproval: false,
        scriptApprovedBy: userId || null,
        scriptApprovedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const regeneration = job.courseRegeneration;
  const initialScriptApproval = job.courseScriptApproval;
  const isRegenerationApproval = Boolean(
    regeneration?.active &&
      regeneration.mode === 'script_and_audio' &&
      regeneration.awaitingScriptApproval
  );
  const isInitialApproval = Boolean(
    initialScriptApproval?.enabled && initialScriptApproval.awaitingApproval
  );

  if (!isRegenerationApproval && !isInitialApproval) {
    throw new Error('There are no course scripts awaiting approval.');
  }

  const targetSessionCodes = isRegenerationApproval
    ? validateCourseSessionCodes(regeneration?.targetSessionCodes || [])
    : getInitialCourseSessionCodes(job);
  if (targetSessionCodes.length === 0) {
    throw new Error(
      isRegenerationApproval
        ? 'There are no regenerated sessions awaiting approval.'
        : 'There are no course scripts awaiting approval.'
    );
  }

  const nextRawScripts: Record<string, string> = { ...(job.courseRawScripts || {}) };
  const nextFormattedScripts: Record<string, string> = { ...(job.courseFormattedScripts || {}) };
  const edits = input?.rawScriptEdits || {};

  for (const sessionCode of targetSessionCodes) {
    const nextRawScript = Object.prototype.hasOwnProperty.call(edits, sessionCode)
      ? String(edits[sessionCode] || '').trim()
      : String(nextRawScripts[sessionCode] || '').trim();

    if (!nextRawScript) {
      throw new Error(`Script cannot be empty for ${sessionCode}.`);
    }

    nextRawScripts[sessionCode] = nextRawScript;
    delete nextFormattedScripts[sessionCode];
  }

  const userId = getCurrentUserId();
  const approvalTimestamp = serverTimestamp();
  const payload: Record<string, any> = {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    courseRawScripts: nextRawScripts,
    courseFormattedScripts: nextFormattedScripts,
    ...freshDispatchResetFields(),
    updatedAt: serverTimestamp(),
  };

  if (isRegenerationApproval) {
    payload.courseProgress = 'Approved regenerated scripts. Preparing audio generation';
    payload.courseRegeneration = {
      ...regeneration,
      awaitingScriptApproval: false,
      scriptApprovedBy: userId || null,
      scriptApprovedAt: approvalTimestamp,
    };
  } else {
    payload.courseProgress = 'Approved scripts. Preparing audio generation';
    payload.courseScriptApproval = {
      ...(initialScriptApproval || { enabled: true }),
      awaitingApproval: false,
      scriptApprovedBy: userId || null,
      scriptApprovedAt: approvalTimestamp,
    };
  }

  await updateDoc(doc(jobsCollection, job.id), payload);
}

export async function regeneratePendingScripts(job: ContentJob): Promise<void> {
  if (job.contentType !== 'course') {
    const scriptApproval = job.scriptApproval;
    if (
      job.status !== 'completed' ||
      !scriptApproval?.enabled ||
      !scriptApproval.awaitingApproval
    ) {
      throw new Error('This job is not currently waiting for script approval.');
    }

    const userId = getCurrentUserId();
    await updateDoc(doc(jobsCollection, job.id), {
      status: 'pending',
      error: null,
      errorCode: null,
      failedStage: null,
      startedAt: null,
      completedAt: null,
      runEndedAt: null,
      lastRunStatus: null,
      publishInProgress: false,
      publishLeaseOwner: null,
      publishLeaseExpiresAt: null,
      generatedScript: null,
      formattedScript: null,
      ...freshDispatchResetFields(),
      scriptApproval: {
        ...scriptApproval,
        awaitingApproval: false,
        scriptApprovedBy: null,
        scriptApprovedAt: null,
        requestedBy: userId || null,
        requestedAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const initialScriptApproval = job.courseScriptApproval;
  if (
    job.status !== 'completed' ||
    !initialScriptApproval?.enabled ||
    !initialScriptApproval.awaitingApproval
  ) {
    throw new Error('This course is not currently waiting for initial script approval.');
  }

  const targetSessionCodes = getInitialCourseSessionCodes(job);
  if (targetSessionCodes.length === 0) {
    throw new Error('There are no course scripts available to regenerate.');
  }

  const nextRawScripts: Record<string, string> = { ...(job.courseRawScripts || {}) };
  const nextFormattedScripts: Record<string, string> = { ...(job.courseFormattedScripts || {}) };
  targetSessionCodes.forEach((sessionCode) => {
    delete nextRawScripts[sessionCode];
    delete nextFormattedScripts[sessionCode];
  });

  const userId = getCurrentUserId();
  await updateDoc(doc(jobsCollection, job.id), {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    imagePrompt: null,
    imagePath: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    courseProgress: `Regenerating scripts for ${targetSessionCodes.length} session${targetSessionCodes.length === 1 ? '' : 's'}`,
    courseRawScripts: nextRawScripts,
    courseFormattedScripts: nextFormattedScripts,
    ...freshDispatchResetFields(),
    courseScriptApproval: {
      ...initialScriptApproval,
      awaitingApproval: false,
      scriptApprovedBy: null,
      scriptApprovedAt: null,
      requestedBy: userId || null,
      requestedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

export async function approveSubjectPlan(
  job: ContentJob,
  input?: {
    courseEdits?: Record<string, { title?: string; description?: string }>;
  }
): Promise<void> {
  if (
    job.contentType !== 'full_subject' ||
    job.status !== 'completed' ||
    !job.subjectPlanApproval?.enabled ||
    !job.subjectPlanApproval.awaitingApproval ||
    !job.subjectPlan
  ) {
    throw new Error('There is no subject lineup awaiting approval for this job.');
  }

  const nextPlan = cloneSubjectPlan(job.subjectPlan);
  const edits = input?.courseEdits || {};

  nextPlan.courses = nextPlan.courses.map((course) => {
    const edit = edits[course.code];
    const nextTitle = String(edit?.title ?? course.title ?? '').trim();
    const nextDescription = String(edit?.description ?? course.description ?? '').trim();
    if (!nextTitle) {
      throw new Error(`Title cannot be empty for ${course.code}.`);
    }
    if (!nextDescription) {
      throw new Error(`Description cannot be empty for ${course.code}.`);
    }
    return {
      ...course,
      title: nextTitle,
      description: nextDescription,
    };
  });

  const userId = getCurrentUserId();
  await updateDoc(doc(jobsCollection, job.id), {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    pauseRequested: false,
    pausedAt: null,
    subjectPlan: nextPlan,
    subjectProgress: 'Approved subject lineup. Launching child courses',
    ...freshDispatchResetFields(),
    subjectPlanApproval: {
      ...job.subjectPlanApproval,
      awaitingApproval: false,
      approvedBy: userId || null,
      approvedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

export async function regenerateSubjectPlan(job: ContentJob): Promise<void> {
  if (
    job.contentType !== 'full_subject' ||
    job.status !== 'completed' ||
    !job.subjectPlanApproval?.enabled ||
    !job.subjectPlanApproval.awaitingApproval
  ) {
    throw new Error('This full subject job is not waiting for lineup approval.');
  }

  const userId = getCurrentUserId();
  await updateDoc(doc(jobsCollection, job.id), {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    subjectPlan: null,
    subjectProgress: 'Regenerating subject curriculum',
    launchCursor: 0,
    childJobIds: [],
    childCounts: emptySubjectChildCounts(),
    pauseRequested: false,
    pausedAt: null,
    ...freshDispatchResetFields(),
    subjectPlanApproval: {
      ...job.subjectPlanApproval,
      awaitingApproval: false,
      approvedBy: null,
      approvedAt: null,
      requestedBy: userId || null,
      requestedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

export async function pauseFullSubjectJob(job: ContentJob): Promise<void> {
  if (job.contentType !== 'full_subject') {
    throw new Error('Pause is only supported for full subject jobs.');
  }
  if (job.status === 'completed' || job.status === 'failed') {
    throw new Error('Only active full subject jobs can be paused.');
  }

  const patch: Record<string, any> = {
    pauseRequested: true,
    updatedAt: serverTimestamp(),
  };

  if (job.status === 'pending' || job.status === 'paused') {
    patch.status = 'paused';
    patch.pausedAt = serverTimestamp();
    patch.subjectProgress = job.subjectProgress || 'Paused before launching more child courses';
    patch.v2Locked = false;
  }

  await updateDoc(doc(jobsCollection, job.id), patch);
}

export async function resumeFullSubjectJob(job: ContentJob): Promise<void> {
  if (job.contentType !== 'full_subject') {
    throw new Error('Resume is only supported for full subject jobs.');
  }
  if (job.status !== 'paused') {
    throw new Error('This full subject job is not paused.');
  }

  await updateDoc(doc(jobsCollection, job.id), {
    status: 'pending',
    error: null,
    errorCode: null,
    pauseRequested: false,
    pausedAt: null,
    subjectProgress: job.subjectProgress || 'Resuming child course launch',
    ...freshDispatchResetFields(),
    updatedAt: serverTimestamp(),
  });
}

// ==================== CANCEL JOB ====================

export async function cancelJob(jobId: string): Promise<void> {
  await updateDoc(doc(jobsCollection, jobId), {
    status: 'failed',
    error: 'Cancelled by admin',
    errorCode: 'cancelled_by_admin',
    failedStage: 'pending',
    runEndedAt: serverTimestamp(),
    lastRunStatus: 'failed',
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    v2Locked: false,
    activeRunElapsedMs: null,
    updatedAt: serverTimestamp(),
  });
}

// ==================== DELETE JOB ====================

export async function requestDeleteJob(jobId: string): Promise<void> {
  await updateDoc(doc(jobsCollection, jobId), {
    deleteRequested: true,
    deleteRequestedAt: serverTimestamp(),
    deleteInProgress: false,
    deleteError: null,
    updatedAt: serverTimestamp(),
  });
}

// ==================== PUBLISH COMPLETED JOB ====================

export async function publishCompletedJob(jobId: string): Promise<void> {
  // Set the job status to 'publishing' so the worker picks it up
  // and runs only the publishing step.
  await updateDoc(doc(jobsCollection, jobId), {
    status: 'publishing',
    autoPublish: true,
    error: null,
    errorCode: null,
    failedStage: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    ...freshDispatchResetFields(),
    updatedAt: serverTimestamp(),
  });
}

// ==================== REGENERATE SINGLE-CONTENT SCRIPT ====================

export async function regenerateSingleContentScript(
  job: ContentJob,
  editedScript: string,
): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');
  if (job.contentType === 'course' || job.contentType === 'full_subject') {
    throw new Error('Use regenerateCourseSessions for course/subject jobs.');
  }
  if (job.status !== 'completed' && job.status !== 'failed') {
    throw new Error('Can only edit scripts on completed or failed jobs.');
  }
  if (!editedScript.trim()) {
    throw new Error('Script cannot be empty.');
  }

  await updateDoc(doc(jobsCollection, job.id), {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    generatedScript: editedScript.trim(),
    formattedScript: null,
    ...freshDispatchResetFields(),
    updatedAt: serverTimestamp(),
  });
}

export async function requestCourseThumbnailGeneration(job: ContentJob): Promise<void> {
  if (job.contentType !== 'course') {
    throw new Error('Thumbnail generation is only supported for course jobs.');
  }
  const hasCompletedCourseOutputs = Boolean(
    job.coursePlan ||
      job.courseId ||
      (job.coursePreviewSessions || []).length > 0 ||
      Object.keys(job.courseAudioResults || {}).length > 0
  );
  if (!hasCompletedCourseOutputs) {
    throw new Error('Finish the course job before generating a deferred thumbnail.');
  }

  await updateDoc(doc(jobsCollection, job.id), {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    publishInProgress: false,
    publishLeaseOwner: null,
    publishLeaseExpiresAt: null,
    courseProgress: job.thumbnailUrl
      ? 'Regenerating course thumbnail'
      : 'Generating deferred course thumbnail',
    thumbnailGenerationRequested: true,
    ...freshDispatchResetFields({ preserveTiming: true }),
    updatedAt: serverTimestamp(),
  });
}

// ==================== CONTENT THUMBNAIL GENERATION ====================

export async function getLatestCompletedJobForContentId(
  contentId: string
): Promise<ContentJob | null> {
  const normalizedId = String(contentId || '').trim();
  if (!normalizedId) return null;
  try {
    const snapshot = await getDocs(
      query(
        jobsCollection,
        where('publishedContentId', '==', normalizedId),
        limit(10)
      )
    );
    const jobs = snapshot.docs
      .map((d) => toContentJob(d.id, d.data() as Record<string, any>))
      .filter((job) => job.status === 'completed');
    return sortJobsNewestFirst(jobs)[0] || null;
  } catch (error) {
    console.error('Error fetching job by published content id:', error);
    return null;
  }
}

export async function requestContentThumbnailGeneration(job: ContentJob): Promise<void> {
  if (job.contentType === 'course') {
    return requestCourseThumbnailGeneration(job);
  }

  const supportedTypes = [
    'guided_meditation',
    'sleep_meditation',
    'bedtime_story',
    'emergency_meditation',
    'album',
    'sleep_sound',
    'white_noise',
    'music',
    'asmr',
    'series',
  ];
  if (!supportedTypes.includes(job.contentType)) {
    throw new Error(`Thumbnail generation is not supported for ${job.contentType} jobs.`);
  }

  if (!job.publishedContentId) {
    throw new Error('This job has not published any content yet.');
  }

  await updateDoc(doc(jobsCollection, job.id), {
    status: 'pending',
    error: null,
    errorCode: null,
    failedStage: null,
    startedAt: null,
    completedAt: null,
    runEndedAt: null,
    lastRunStatus: null,
    thumbnailGenerationRequested: true,
    ...freshDispatchResetFields({ preserveTiming: true }),
    updatedAt: serverTimestamp(),
  });
}

// ==================== UPDATE TITLE ====================

export async function updateJobTitle(jobId: string, title: string): Promise<void> {
  await updateDoc(doc(jobsCollection, jobId), {
    generatedTitle: title.trim(),
    updatedAt: serverTimestamp(),
  });
}

const COLLECTION_TO_CONTENT_TYPE: Record<string, FactoryContentType> = {
  guided_meditations: 'guided_meditation',
  sleep_meditations: 'sleep_meditation',
  bedtime_stories: 'bedtime_story',
  emergency_meditations: 'emergency_meditation',
  courses: 'course',
  course_sessions: 'course_session',
  albums: 'album',
  sleep_sounds: 'sleep_sound',
  white_noise: 'white_noise',
  music: 'music',
  asmr: 'asmr',
  series: 'series',
};

/**
 * Create a minimal factory job for content that was seeded (not factory-created)
 * so we can generate a thumbnail for it. The job starts at the `generate_image`
 * step and writes the result back to the content document.
 */
export async function createThumbnailOnlyJob(opts: {
  contentId: string;
  collection: string;
  title: string;
  description?: string;
}): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error('Not authenticated');

  const contentType = COLLECTION_TO_CONTENT_TYPE[opts.collection];
  if (!contentType || contentType === 'course_session' || contentType === 'full_subject') {
    throw new Error(`Thumbnail-only jobs are not supported for ${opts.collection}.`);
  }

  const jobData: Record<string, any> = {
    status: 'pending',
    contentType,
    params: { topic: opts.title },
    title: opts.title,
    publishedContentId: opts.contentId,
    thumbnailGenerationRequested: true,
    autoPublish: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: userId,
    // Minimal fields so the worker can bootstrap
    llmBackend: 'lmstudio',
    ttsBackend: 'dms',
    llmModel: 'lmstudio-local',
    ttsModel: '',
    ttsVoice: '',
    generatedTitle: opts.title,
    // Store description in params for image prompt context, not as generatedScript
    // (generatedScript triggers script validation in format_script which would fail)
  };

  if (opts.description) {
    jobData.params.description = opts.description;
  }

  const docRef = await addDoc(jobsCollection, jobData);
  return docRef.id;
}

// ==================== FACTORY METRICS ====================

export function subscribeToFactoryMetrics(
  callback: (metrics: FactoryMetrics | null) => void
): Unsubscribe {
  const dateKey = new Date().toISOString().slice(0, 10);
  const metricsDoc = doc(db, 'factory_metrics', dateKey);
  return onSnapshot(metricsDoc, (docSnapshot) => {
    if (!docSnapshot.exists()) {
      callback(null);
      return;
    }
    const data = docSnapshot.data() as Record<string, any>;
    callback({ id: docSnapshot.id, ...data } as FactoryMetrics);
  });
}
