/**
 * Job execution state resolution and visualization utilities.
 *
 * ARCHITECTURAL ROLE:
 * Bridges the dual-engine architecture by synthesizing ContentJob (legacy) and
 * FactoryJob (new V2 engine) states into a unified JobExecutionView.
 *
 * DESIGN PATTERNS:
 * - State Machine synthesis: Resolves two parallel state machines into canonical status
 * - Status source tracking: Records whether truth comes from legacy, factory, or both
 * - Projection drift detection: Identifies mismatches between expected and actual engine state
 * - Step-to-status mapping: Maps factory step names to legacy JobStatus for UI compatibility
 *
 * CRITICAL CONCEPTS:
 * - Effective status: The user-visible status (resolved from all sources)
 * - Status source: Where the effective status was sourced (content_job, factory_job, or mixed)
 * - Projection drift: Discrepancies between legacy projection and factory truth
 *
 * MULTI-ENGINE COORDINATION:
 * V1 (legacy): ContentJob.status (a projection of execution state)
 * V2 (factory): FactoryJob + FactoryJobRun (source of truth for v2 jobs)
 * Resolution: If V2 job has factory state, use it; else fall back to ContentJob.status
 */

import {
  ContentJob,
  FactoryJob,
  FactoryJobRun,
  FactoryJobState,
  JobExecutionRunState,
  JobExecutionStatusSource,
  JobExecutionView,
  JOB_STATUS_LABELS,
  JobStatus,
} from '../types';

/**
 * Maps V2 factory step names to legacy JobStatus for visualization.
 * This enables UI to show progress even though engine uses different terminology.
 */
const COMPAT_STATUS_BY_STEP: Record<string, JobStatus> = {
  generate_script: 'llm_generating',
  format_script: 'qa_formatting',
  generate_image: 'image_generating',
  synthesize_audio: 'tts_converting',
  post_process_audio: 'post_processing',
  upload_audio: 'uploading',
  publish_content: 'publishing',
  generate_course_plan: 'llm_generating',
  generate_course_scripts: 'llm_generating',
  format_course_scripts: 'qa_formatting',
  generate_course_thumbnail: 'image_generating',
  synthesize_course_audio_chunk: 'tts_converting',
  synthesize_course_audio: 'tts_converting',
  upload_course_audio: 'uploading',
  publish_course: 'publishing',
  generate_subject_plan: 'llm_generating',
  launch_subject_children: 'llm_generating',
  watch_subject_children: 'llm_generating',
};

function trimString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function normalizeFactoryJobState(value: unknown): FactoryJobState | undefined {
  const state = String(value || '').trim().toLowerCase();
  switch (state) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return state;
    default:
      return undefined;
  }
}

function normalizeRunState(value: unknown): JobExecutionRunState | undefined {
  const state = String(value || '').trim().toLowerCase();
  switch (state) {
    case 'running':
    case 'completed':
    case 'failed':
      return state;
    default:
      return undefined;
  }
}

/**
 * Check if a job is awaiting fresh dispatch (no active run, engine is idle).
 * Indicates the job is pending or awaiting republish, with no run in progress.
 */
function isFreshDispatchRequest(job: ContentJob, compatStatus: JobStatus, engineCurrentState?: FactoryJobState): boolean {
  if (compatStatus !== 'pending' && compatStatus !== 'publishing') {
    return false;
  }

  if (trimString(job.v2RunId) || normalizeRunState(job.lastRunStatus)) {
    return false;
  }

  return (
    engineCurrentState === 'completed' ||
    engineCurrentState === 'failed' ||
    engineCurrentState === 'cancelled'
  );
}

function formatWords(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Determine if a job is running on V2 engine (factory architecture).
 * V1 jobs have no v2* fields or factory objects.
 */
function isV2Job(job: ContentJob, factoryJob?: FactoryJob | null, factoryRun?: FactoryJobRun | null): boolean {
  return Boolean(job.engine === 'v2' || job.v2JobId || job.v2RunId || factoryJob || factoryRun);
}

/**
 * Resolve dual-engine state into a unified view for the UI.
 *
 * ALGORITHM:
 * 1. Start with legacy status (compatStatus = job.status)
 * 2. If V2 job, inspect factory state (FactoryJob, FactoryJobRun)
 * 3. Apply resolution rules (see inline comments)
 * 4. Detect projection drift (ContentJob.status vs FactoryJob state mismatch)
 * 5. Return effectiveStatus + source + drift info for UI display
 *
 * RULES (when V2 job):
 * - Paused status takes precedence (job or subject pause)
 * - Fresh dispatch requests: pending/publishing + idle engine = use compatStatus
 * - Failed/cancelled engine: effectiveStatus = failed (engine truth)
 * - Completed engine: effectiveStatus = completed
 * - Running engine: use step-to-status mapping for detail
 * - Queued engine: pending (or publishing if already publishing)
 */
export function resolveJobExecutionView(
  job: ContentJob | null | undefined,
  factoryJob?: FactoryJob | null,
  factoryRun?: FactoryJobRun | null
): JobExecutionView | null {
  if (!job) {
    return null;
  }

  const compatStatus = job.status;
  const engineCurrentState = normalizeFactoryJobState(factoryJob?.currentState);
  const engineStepName = trimString(factoryJob?.summary?.currentStep);
  const engineRunId =
    trimString(factoryJob?.currentRunId) ||
    trimString(factoryRun?.id) ||
    trimString(job.v2RunId);
  const engineRunState =
    normalizeRunState(factoryRun?.state) ||
    normalizeRunState(factoryJob?.summary?.lastRunStatus) ||
    (engineCurrentState === 'running'
      ? 'running'
      : engineCurrentState === 'completed'
        ? 'completed'
        : engineCurrentState === 'failed' || engineCurrentState === 'cancelled'
          ? 'failed'
          : normalizeRunState(job.lastRunStatus));
  const subjectState = String(factoryJob?.summary?.subjectState || '').trim().toLowerCase();

  let effectiveStatus = compatStatus;
  let statusSource: JobExecutionStatusSource = 'content_job';

  if (isV2Job(job, factoryJob, factoryRun)) {
    if (compatStatus === 'paused' || subjectState === 'paused') {
      effectiveStatus = 'paused';
      statusSource = engineCurrentState ? 'mixed' : 'content_job';
    } else if (isFreshDispatchRequest(job, compatStatus, engineCurrentState)) {
      effectiveStatus = compatStatus;
      statusSource = 'mixed';
    } else if (engineRunState === 'failed' || engineCurrentState === 'failed' || engineCurrentState === 'cancelled') {
      effectiveStatus = 'failed';
      statusSource = 'factory_job';
    } else if (engineRunState === 'completed' || engineCurrentState === 'completed') {
      effectiveStatus = 'completed';
      statusSource = 'factory_job';
    } else if (engineRunState === 'running' || engineCurrentState === 'running') {
      const mappedStatus = engineStepName ? COMPAT_STATUS_BY_STEP[engineStepName] : undefined;
      effectiveStatus = mappedStatus || compatStatus;
      statusSource = mappedStatus ? 'factory_job' : 'mixed';
    } else if (engineCurrentState === 'queued') {
      effectiveStatus = compatStatus === 'publishing' ? 'publishing' : 'pending';
      statusSource = 'mixed';
    }
  }

  const projectionDrift: string[] = [];
  if (isV2Job(job, factoryJob, factoryRun)) {
    const compatRunId = trimString(job.v2RunId);
    if (compatRunId && engineRunId && compatRunId !== engineRunId) {
      projectionDrift.push(
        `Projected run id is "${compatRunId}", but the engine is on "${engineRunId}".`
      );
    }

    const compatRunStatus = normalizeRunState(job.lastRunStatus);
    if (compatRunStatus && engineRunState && compatRunStatus !== engineRunState) {
      projectionDrift.push(
        `Projected run status is "${compatRunStatus}", but the engine reports "${engineRunState}".`
      );
    }

    if (compatStatus !== effectiveStatus) {
      projectionDrift.push(
        `Projected status is "${JOB_STATUS_LABELS[compatStatus]}", but engine truth resolves to "${JOB_STATUS_LABELS[effectiveStatus]}".`
      );
    }
  }

  return {
    effectiveStatus,
    effectiveRunStatus: engineRunState,
    statusSource,
    engineCurrentState,
    engineRunId,
    engineStepName,
    projectionDrift,
    isProjectionDrifted: projectionDrift.length > 0,
  };
}

/** Format the status source for admin UI tooltips/help text. */
export function formatExecutionStatusSource(source: JobExecutionStatusSource): string {
  switch (source) {
    case 'factory_job':
      return 'Factory runtime';
    case 'mixed':
      return 'Factory runtime + compatibility projection';
    case 'content_job':
    default:
      return 'Compatibility projection';
  }
}

/** Format factory job state to human-readable label (e.g., "running", "failed"). */
export function formatFactoryJobStateLabel(state?: FactoryJobState): string {
  return state ? formatWords(state) : '';
}

/** Format run state to human-readable label. */
export function formatRunStateLabel(state?: JobExecutionRunState): string {
  return state ? formatWords(state) : '';
}
