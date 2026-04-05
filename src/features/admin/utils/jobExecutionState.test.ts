import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import { ContentJob, FactoryJob, FactoryJobRun } from '../types';
import { resolveJobExecutionView } from './jobExecutionState';

function makeJob(overrides: Partial<ContentJob> = {}): ContentJob {
  return {
    id: 'job-1',
    status: 'pending',
    llmBackend: 'local',
    ttsBackend: 'local',
    contentType: 'course',
    params: {
      topic: 'Topic',
      duration_minutes: 30,
      courseCode: 'DBT101',
      courseTitle: 'DBT 101',
    },
    llmModel: 'llm',
    ttsModel: 'tts',
    ttsVoice: 'voice-1',
    autoPublish: false,
    engine: 'v2',
    v2JobId: 'job-1',
    v2RunId: 'job-1-r1',
    createdAt: Timestamp.fromMillis(1),
    updatedAt: Timestamp.fromMillis(1),
    createdBy: 'admin',
    ...overrides,
  };
}

function makeFactoryJob(overrides: Partial<FactoryJob> = {}): FactoryJob {
  return {
    id: 'job-1',
    currentState: 'running',
    currentRunId: 'job-1-r1',
    summary: {
      currentStep: 'generate_course_scripts',
      lastRunStatus: 'running',
    },
    ...overrides,
  };
}

function makeFactoryRun(overrides: Partial<FactoryJobRun> = {}): FactoryJobRun {
  return {
    id: 'job-1-r1',
    jobId: 'job-1',
    state: 'running',
    ...overrides,
  };
}

describe('resolveJobExecutionView', () => {
  it('prefers factory step state over a stale projected terminal status', () => {
    const job = makeJob({
      status: 'completed',
      lastRunStatus: 'completed',
      v2RunId: 'job-1-r1',
    });
    const factoryJob = makeFactoryJob({
      currentState: 'running',
      currentRunId: 'job-1-r2',
      summary: {
        currentStep: 'generate_course_scripts',
        lastRunStatus: 'running',
      },
    });
    const factoryRun = makeFactoryRun({
      id: 'job-1-r2',
      state: 'running',
    });

    const view = resolveJobExecutionView(job, factoryJob, factoryRun);

    expect(view?.effectiveStatus).toBe('llm_generating');
    expect(view?.effectiveRunStatus).toBe('running');
    expect(view?.engineRunId).toBe('job-1-r2');
    expect(view?.isProjectionDrifted).toBe(true);
    expect(view?.projectionDrift).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Projected run id'),
        expect.stringContaining('Projected run status'),
        expect.stringContaining('Projected status'),
      ])
    );
  });

  it('preserves paused subject status when the engine run has already completed', () => {
    const job = makeJob({
      contentType: 'full_subject',
      status: 'paused',
      params: {
        topic: 'Topic',
        duration_minutes: 30,
        subjectId: 'dbt',
        subjectLabel: 'DBT',
        levelCounts: { l100: 1, l200: 0, l300: 0, l400: 0 },
        courseCount: 1,
      },
      lastRunStatus: 'completed',
    });
    const factoryJob = makeFactoryJob({
      currentState: 'completed',
      summary: {
        currentStep: 'watch_subject_children',
        lastRunStatus: 'completed',
        subjectState: 'paused',
      },
    });
    const factoryRun = makeFactoryRun({
      id: 'job-1-r1',
      state: 'completed',
    });

    const view = resolveJobExecutionView(job, factoryJob, factoryRun);

    expect(view?.effectiveStatus).toBe('paused');
    expect(view?.effectiveRunStatus).toBe('completed');
    expect(view?.isProjectionDrifted).toBe(false);
  });

  it('shows a fresh rerun request as pending before the new factory run is bootstrapped', () => {
    const job = makeJob({
      status: 'pending',
      v2RunId: undefined,
      lastRunStatus: undefined,
      thumbnailGenerationRequested: true,
    });
    const factoryJob = makeFactoryJob({
      currentState: 'completed',
      currentRunId: 'job-1-r1',
      summary: {
        currentStep: 'publish_course',
        lastRunStatus: 'completed',
      },
    });
    const factoryRun = makeFactoryRun({
      id: 'job-1-r1',
      state: 'completed',
    });

    const view = resolveJobExecutionView(job, factoryJob, factoryRun);

    expect(view?.effectiveStatus).toBe('pending');
    expect(view?.effectiveRunStatus).toBe('completed');
    expect(view?.statusSource).toBe('mixed');
    expect(view?.isProjectionDrifted).toBe(false);
  });

  it('shows a fresh publish request as publishing before the new factory run is bootstrapped', () => {
    const job = makeJob({
      status: 'publishing',
      v2RunId: undefined,
      lastRunStatus: undefined,
    });
    const factoryJob = makeFactoryJob({
      currentState: 'completed',
      currentRunId: 'job-1-r1',
      summary: {
        currentStep: 'publish_course',
        lastRunStatus: 'completed',
      },
    });
    const factoryRun = makeFactoryRun({
      id: 'job-1-r1',
      state: 'completed',
    });

    const view = resolveJobExecutionView(job, factoryJob, factoryRun);

    expect(view?.effectiveStatus).toBe('publishing');
    expect(view?.effectiveRunStatus).toBe('completed');
    expect(view?.statusSource).toBe('mixed');
    expect(view?.isProjectionDrifted).toBe(false);
  });

  it('falls back to content_jobs when no factory state is available', () => {
    const job = makeJob({
      status: 'uploading',
      engine: undefined,
      v2JobId: undefined,
      v2RunId: undefined,
    });

    const view = resolveJobExecutionView(job, null, null);

    expect(view?.effectiveStatus).toBe('uploading');
    expect(view?.statusSource).toBe('content_job');
    expect(view?.isProjectionDrifted).toBe(false);
  });
});
