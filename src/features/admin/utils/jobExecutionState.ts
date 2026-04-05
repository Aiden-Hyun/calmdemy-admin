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

function isV2Job(job: ContentJob, factoryJob?: FactoryJob | null, factoryRun?: FactoryJobRun | null): boolean {
  return Boolean(job.engine === 'v2' || job.v2JobId || job.v2RunId || factoryJob || factoryRun);
}

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

export function formatFactoryJobStateLabel(state?: FactoryJobState): string {
  return state ? formatWords(state) : '';
}

export function formatRunStateLabel(state?: JobExecutionRunState): string {
  return state ? formatWords(state) : '';
}
