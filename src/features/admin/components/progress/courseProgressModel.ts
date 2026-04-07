/**
 * Course progress model: synthesizes V2 factory timeline into stages and shards.
 *
 * ARCHITECTURAL ROLE:
 * Transforms raw factory step timeline into hierarchical progress structure:
 * Course stages (7 pipeline steps) -> Audio shards (9 sessions INT/M1-4L/P).
 * Provides state aggregation, worker tracking, and error reporting.
 *
 * DESIGN PATTERN:
 * - Pipeline model: Stages are sequential (plan -> scripts -> audio -> upload -> publish)
 * - Sharding model: Audio generation runs per-session; synthesis is parallelizable
 * - Attempt tracking: Records which attempt, worker, and error for each step
 * - State reduction: Aggregates multiple entries into highest-level state
 *
 * KEY CONCEPTS:
 * - ProgressState: Lifecycle states (waiting, queued, running, retrying, succeeded, failed, cancelled)
 * - CourseStageStep: 7 canonical stages in course generation pipeline
 * - CourseShardKey: 9 audio sessions (INT, M1L, M1P, M2L, M2P, M3L, M3P, M4L, M4P)
 * - WorkerLane: Timeline of steps executed by a single worker
 * - CourseProgressModel: Complete hierarchical view of job execution
 */

import { ContentJob, JobStepTimelineEntry } from '../../types';

export type ProgressState =
  | 'waiting'
  | 'queued'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export const COURSE_STAGE_STEPS = [
  'generate_course_plan',
  'generate_course_thumbnail',
  'generate_course_scripts',
  'format_course_scripts',
  'synthesize_course_audio',
  'upload_course_audio',
  'publish_course',
] as const;

export type CourseStageStep = (typeof COURSE_STAGE_STEPS)[number];

export const COURSE_SHARD_KEYS = [
  'INT',
  'M1L',
  'M1P',
  'M2L',
  'M2P',
  'M3L',
  'M3P',
  'M4L',
  'M4P',
] as const;

export type CourseShardKey = (typeof COURSE_SHARD_KEYS)[number];

const CANCELLED_ERROR_CODES = new Set(['superseded_run', 'run_failed']);
const VALID_SHARDS = new Set<string>(COURSE_SHARD_KEYS);
const SYNTH_STAGE_STEP_NAMES = new Set(['synthesize_course_audio', 'synthesize_course_audio_chunk']);
const CHUNK_SYNTH_STEP = 'synthesize_course_audio_chunk';

const STAGE_LABELS: Record<CourseStageStep, string> = {
  generate_course_plan: 'Generate Course Plan',
  generate_course_thumbnail: 'Generate Course Thumbnail',
  generate_course_scripts: 'Generate Course Scripts',
  format_course_scripts: 'Format Course Scripts',
  synthesize_course_audio: 'Synthesize Course Audio',
  upload_course_audio: 'Upload Course Audio',
  publish_course: 'Publish Course',
};

const SHARD_LABELS: Record<CourseShardKey, string> = {
  INT: 'Course Intro',
  M1L: 'Module 1 Lesson',
  M1P: 'Module 1 Practice',
  M2L: 'Module 2 Lesson',
  M2P: 'Module 2 Practice',
  M3L: 'Module 3 Lesson',
  M3P: 'Module 3 Practice',
  M4L: 'Module 4 Lesson',
  M4P: 'Module 4 Practice',
};

export type StageProgress = {
  stepName: CourseStageStep;
  label: string;
  state: ProgressState;
  attempt?: number;
  workerId?: string;
  workerLabel?: string;
  errorCode?: string;
  errorMessage?: string;
  entryCount: number;
};

export type ShardProgress = {
  shardKey: CourseShardKey;
  label: string;
  state: ProgressState;
  attempt?: number;
  workerId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type WorkerLaneItem = {
  id: string;
  stepName: string;
  stepLabel: string;
  shardKey?: string;
  shardLabel?: string;
  state: ProgressState;
  attempt?: number;
  errorCode?: string;
  errorMessage?: string;
  timestampMs: number;
};

export type WorkerLane = {
  workerId: string;
  items: WorkerLaneItem[];
};

export type CourseProgressModel = {
  selectedRunId?: string;
  runEntries: JobStepTimelineEntry[];
  stages: Record<CourseStageStep, StageProgress>;
  audioShards: Record<CourseShardKey, ShardProgress>;
  audioSummary: Record<ProgressState, number>;
  uploadBlockedReason?: string;
  hasLegacyRootSynth: boolean;
  workerLanes: WorkerLane[];
};

function timestampMs(entry: JobStepTimelineEntry): number {
  return (
    entry.timestamp?.toMillis?.() ||
    entry.updatedAt?.toMillis?.() ||
    entry.endedAt?.toMillis?.() ||
    entry.startedAt?.toMillis?.() ||
    0
  );
}

function stepNameLabel(stepName: string): string {
  const known = STAGE_LABELS[stepName as CourseStageStep];
  if (known) return known;
  if (stepName === CHUNK_SYNTH_STEP) return 'Synthesize Course Audio Chunk';
  return stepName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeShardKey(value?: string): CourseShardKey | undefined {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return undefined;
  if (VALID_SHARDS.has(key)) return key as CourseShardKey;
  const matched = COURSE_SHARD_KEYS.find((shard) => key === shard || key.startsWith(`${shard}-P`));
  return matched;
}

function completedShardsFromContentJob(job: ContentJob): Set<CourseShardKey> {
  const completed = new Set<CourseShardKey>();
  const results = job.courseAudioResults || {};
  for (const [sessionCode, payload] of Object.entries(results)) {
    if (!payload || typeof payload !== 'object') continue;
    const storagePath = String((payload as { storagePath?: unknown }).storagePath || '').trim();
    if (!storagePath) continue;
    const normalized = String(sessionCode || '').trim().toUpperCase();
    for (const shard of COURSE_SHARD_KEYS) {
      if (normalized.endsWith(shard)) {
        completed.add(shard);
        break;
      }
    }
  }
  return completed;
}

function courseGeneratesThumbnailDuringRun(job: ContentJob): boolean {
  if (typeof job.generateThumbnailDuringRun === 'boolean') {
    return job.generateThumbnailDuringRun;
  }
  return true;
}

function pickNewestEntry(entries: JobStepTimelineEntry[]): JobStepTimelineEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => timestampMs(b) - timestampMs(a))[0];
}

function statePriority(state: ProgressState): number {
  switch (state) {
    case 'failed':
      return 700;
    case 'running':
      return 600;
    case 'retrying':
      return 500;
    case 'queued':
      return 400;
    case 'succeeded':
      return 300;
    case 'cancelled':
      return 200;
    default:
      return 100;
  }
}

function mergeState(states: ProgressState[]): ProgressState {
  if (states.length === 0) return 'waiting';
  if (states.includes('failed')) return 'failed';
  if (states.includes('running')) return 'running';
  if (states.includes('retrying')) return 'retrying';
  if (states.includes('queued')) return 'queued';
  if (states.every((state) => state === 'succeeded')) return 'succeeded';
  if (states.every((state) => state === 'cancelled')) return 'cancelled';
  if (states.includes('succeeded')) return 'running';
  return 'waiting';
}

function mergeChunkState(states: ProgressState[]): ProgressState {
  if (states.length === 0) return 'waiting';
  if (states.includes('failed')) return 'failed';
  if (states.includes('running')) return 'running';
  if (states.includes('retrying')) return 'retrying';
  if (states.every((state) => state === 'succeeded')) return 'succeeded';
  if (states.every((state) => state === 'cancelled')) return 'cancelled';
  if (states.includes('succeeded')) return 'running';
  if (states.includes('queued')) return 'queued';
  return 'waiting';
}

export function progressStateFromEntry(entry: JobStepTimelineEntry): ProgressState {
  const state = String(entry.state || '').trim().toLowerCase();
  if (state === 'ready' || state === 'leased') return 'queued';
  if (state === 'running') return 'running';
  if (state === 'retry_scheduled') return 'retrying';
  if (state === 'succeeded') return 'succeeded';
  if (state === 'failed') {
    return CANCELLED_ERROR_CODES.has(String(entry.errorCode || '').trim())
      ? 'cancelled'
      : 'failed';
  }
  return 'waiting';
}

export function progressStateLabel(state: ProgressState): string {
  switch (state) {
    case 'waiting':
      return 'Waiting';
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'retrying':
      return 'Retrying';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Waiting';
  }
}

function selectRepresentative(entries: JobStepTimelineEntry[]): JobStepTimelineEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => {
    const stateDelta = statePriority(progressStateFromEntry(b)) - statePriority(progressStateFromEntry(a));
    if (stateDelta !== 0) return stateDelta;
    return timestampMs(b) - timestampMs(a);
  })[0];
}

function chunkRepresentativePriority(state: ProgressState): number {
  switch (state) {
    case 'failed':
      return 700;
    case 'running':
      return 600;
    case 'retrying':
      return 500;
    case 'succeeded':
      return 400;
    case 'queued':
      return 300;
    case 'cancelled':
      return 200;
    default:
      return 100;
  }
}

function selectChunkRepresentative(entries: JobStepTimelineEntry[]): JobStepTimelineEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => {
    const stateDelta =
      chunkRepresentativePriority(progressStateFromEntry(b)) -
      chunkRepresentativePriority(progressStateFromEntry(a));
    if (stateDelta !== 0) return stateDelta;
    return timestampMs(b) - timestampMs(a);
  })[0];
}

function buildStageProgress(
  stepName: CourseStageStep,
  entries: JobStepTimelineEntry[]
): StageProgress {
  const states = entries.map(progressStateFromEntry);
  const state = mergeState(states);
  const representative = selectRepresentative(entries);
  const workerSet = new Set(
    entries.map((entry) => String(entry.workerId || '').trim()).filter(Boolean)
  );

  let workerLabel: string | undefined;
  if (workerSet.size === 1) {
    workerLabel = [...workerSet][0];
  } else if (workerSet.size > 1) {
    workerLabel = `${workerSet.size} workers`;
  }

  return {
    stepName,
    label: STAGE_LABELS[stepName],
    state,
    attempt: representative?.attempt,
    workerId: representative?.workerId,
    workerLabel,
    errorCode: representative?.errorCode,
    errorMessage: representative?.errorMessage,
    entryCount: entries.length,
  };
}

function sortWorkerIds(ids: string[]): string[] {
  const score = (workerId: string): [number, number, string] => {
    if (workerId === 'local-primary') return [0, 0, workerId];
    const dmsMatch = workerId.match(/^local-tts-dms-(\d+)$/);
    if (dmsMatch) return [1, Number(dmsMatch[1] || 0), workerId];
    const qwenMatch = workerId.match(/^local-tts-qwen(?:-(\d+))?$/);
    if (qwenMatch) return [2, Number(qwenMatch[1] || 1), workerId];
    if (workerId === 'unknown') return [9, 0, workerId];
    return [5, 0, workerId];
  };
  return [...ids].sort((a, b) => {
    const as = score(a);
    const bs = score(b);
    if (as[0] !== bs[0]) return as[0] - bs[0];
    if (as[1] !== bs[1]) return as[1] - bs[1];
    return as[2].localeCompare(bs[2]);
  });
}

export function pickSelectedRunId(
  job: ContentJob,
  timelineEntries: JobStepTimelineEntry[],
  preferredRunId?: string
): string | undefined {
  const preferred = String(preferredRunId || '').trim();
  if (preferred) return preferred;

  const jobRunId = String(job.v2RunId || '').trim();
  if (jobRunId) return jobRunId;

  const latestEntry = [...timelineEntries]
    .filter((entry) => Boolean(entry.runId))
    .sort((a, b) => timestampMs(b) - timestampMs(a))[0];
  return latestEntry?.runId;
}

export function deriveCourseProgressModel(
  job: ContentJob,
  timelineEntries: JobStepTimelineEntry[],
  preferredRunId?: string
): CourseProgressModel {
  const selectedRunId = pickSelectedRunId(job, timelineEntries, preferredRunId);
  const runEntries = selectedRunId
    ? timelineEntries.filter((entry) => entry.runId === selectedRunId)
    : [...timelineEntries];

  const stageEntries = new Map<CourseStageStep, JobStepTimelineEntry[]>();
  COURSE_STAGE_STEPS.forEach((stepName) => stageEntries.set(stepName, []));

  const synthEntries: JobStepTimelineEntry[] = [];
  for (const entry of runEntries) {
    const stepName = entry.stepName as CourseStageStep;
    if (stageEntries.has(stepName)) {
      stageEntries.get(stepName)?.push(entry);
    }
    if (SYNTH_STAGE_STEP_NAMES.has(entry.stepName)) {
      synthEntries.push(entry);
    }
  }

  const audioShards: Record<CourseShardKey, ShardProgress> = {} as Record<CourseShardKey, ShardProgress>;
  COURSE_SHARD_KEYS.forEach((shardKey) => {
    audioShards[shardKey] = {
      shardKey,
      label: SHARD_LABELS[shardKey],
      state: 'waiting',
    };
  });

  const shardSynthEntries = new Map<CourseShardKey, JobStepTimelineEntry[]>();
  const rootSynthEntries: JobStepTimelineEntry[] = [];
  for (const entry of synthEntries) {
    const shardKey = normalizeShardKey(entry.shardKey);
    if (!shardKey) {
      rootSynthEntries.push(entry);
      continue;
    }
    const list = shardSynthEntries.get(shardKey) || [];
    list.push(entry);
    shardSynthEntries.set(shardKey, list);
  }

  shardSynthEntries.forEach((entries, shardKey) => {
    const sessionEntries = entries.filter((entry) => entry.stepName === 'synthesize_course_audio');
    const chunkEntries = entries.filter((entry) => entry.stepName === CHUNK_SYNTH_STEP);
    const representative =
      sessionEntries.length > 0
        ? pickNewestEntry(sessionEntries.sort((a, b) => timestampMs(b) - timestampMs(a)))
        : selectChunkRepresentative(chunkEntries);
    let state: ProgressState;
    if (sessionEntries.length > 0) {
      state = mergeState(sessionEntries.map(progressStateFromEntry));
    } else {
      const chunkStates = chunkEntries.map(progressStateFromEntry);
      state = mergeChunkState(chunkStates);
      if (state === 'succeeded') {
        state = 'running';
      }
    }
    audioShards[shardKey] = {
      shardKey,
      label: SHARD_LABELS[shardKey],
      state,
      attempt: representative?.attempt,
      workerId: representative?.workerId,
      errorCode: representative?.errorCode,
      errorMessage: representative?.errorMessage,
    };
  });

  const checkpointCompletedShards = completedShardsFromContentJob(job);
  checkpointCompletedShards.forEach((shardKey) => {
    const current = audioShards[shardKey];
    if (current.state !== 'waiting') return;
    audioShards[shardKey] = {
      ...current,
      state: 'succeeded',
      workerId: 'checkpoint',
    };
  });

  const audioSummary: Record<ProgressState, number> = {
    waiting: 0,
    queued: 0,
    running: 0,
    retrying: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  COURSE_SHARD_KEYS.forEach((shardKey) => {
    audioSummary[audioShards[shardKey].state] += 1;
  });

  const stages: Record<CourseStageStep, StageProgress> = {} as Record<CourseStageStep, StageProgress>;
  COURSE_STAGE_STEPS.forEach((stepName) => {
    const entries = stageEntries.get(stepName) || [];
    stages[stepName] = buildStageProgress(stepName, entries);
  });

  const thumbnailIsDeferred = !courseGeneratesThumbnailDuringRun(job);
  if (thumbnailIsDeferred && stages.generate_course_thumbnail.state === 'waiting') {
    if (job.thumbnailUrl || job.imagePath) {
      stages.generate_course_thumbnail = {
        ...stages.generate_course_thumbnail,
        state: 'succeeded',
        workerLabel: 'Deferred run',
      };
    } else if (!job.thumbnailGenerationRequested) {
      stages.generate_course_thumbnail = {
        ...stages.generate_course_thumbnail,
        state: 'cancelled',
        workerLabel: 'Deferred',
      };
    }
  }

  const hasLegacyRootSynth =
    rootSynthEntries.length > 0 && shardSynthEntries.size === 0;
  if (hasLegacyRootSynth) {
    stages.synthesize_course_audio = buildStageProgress(
      'synthesize_course_audio',
      rootSynthEntries
    );
  } else if (shardSynthEntries.size > 0 || checkpointCompletedShards.size > 0) {
    const shardStates = COURSE_SHARD_KEYS.map((shardKey) => audioShards[shardKey].state);
    const synthState = mergeState(shardStates);
    const representative = pickNewestEntry([...synthEntries].sort((a, b) => timestampMs(b) - timestampMs(a)));
    const runningWorkers = new Set(
      synthEntries
        .filter((entry) => progressStateFromEntry(entry) === 'running')
        .map((entry) => String(entry.workerId || '').trim())
        .filter(Boolean)
    );
    stages.synthesize_course_audio = {
      ...stages.synthesize_course_audio,
      state: synthState,
      attempt: representative?.attempt,
      workerId: representative?.workerId,
      workerLabel:
        runningWorkers.size > 1
          ? `${runningWorkers.size} workers`
          : runningWorkers.size === 1
            ? [...runningWorkers][0]
            : stages.synthesize_course_audio.workerLabel,
      entryCount: shardSynthEntries.size,
    };
  }

  let uploadBlockedReason: string | undefined;
  if (!hasLegacyRootSynth) {
    if (audioSummary.failed > 0) {
      uploadBlockedReason = 'Blocked: one or more synth shards failed.';
    } else {
      const remaining = COURSE_SHARD_KEYS.length - audioSummary.succeeded;
      const uploadState = stages.upload_course_audio.state;
      if (remaining > 0 && (uploadState === 'waiting' || uploadState === 'queued' || uploadState === 'retrying')) {
        uploadBlockedReason = `Blocked: waiting for ${remaining}/9 synth shards.`;
      }
    }
  }

  const laneMap = new Map<string, WorkerLaneItem[]>();
  for (const entry of runEntries) {
    const workerId = String(entry.workerId || 'unknown').trim() || 'unknown';
    const shardKey = normalizeShardKey(entry.shardKey);
    const rawShardKey = String(entry.shardKey || '').trim();
    const laneItem: WorkerLaneItem = {
      id: entry.id,
      stepName: entry.stepName,
      stepLabel: stepNameLabel(entry.stepName),
      shardKey:
        entry.stepName === CHUNK_SYNTH_STEP && rawShardKey && rawShardKey !== 'root'
          ? rawShardKey
          : shardKey || (rawShardKey && rawShardKey !== 'root' ? rawShardKey : undefined),
      shardLabel: shardKey ? SHARD_LABELS[shardKey] : undefined,
      state: progressStateFromEntry(entry),
      attempt: entry.attempt,
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
      timestampMs: timestampMs(entry),
    };
    const list = laneMap.get(workerId) || [];
    list.push(laneItem);
    laneMap.set(workerId, list);
  }

  const workerLanes: WorkerLane[] = sortWorkerIds([...laneMap.keys()]).map((workerId) => {
    const items = [...(laneMap.get(workerId) || [])].sort((a, b) => {
      const priorityDelta = statePriority(b.state) - statePriority(a.state);
      if (priorityDelta !== 0) return priorityDelta;
      return b.timestampMs - a.timestampMs;
    });
    return { workerId, items };
  });

  return {
    selectedRunId,
    runEntries,
    stages,
    audioShards,
    audioSummary,
    uploadBlockedReason,
    hasLegacyRootSynth,
    workerLanes,
  };
}
