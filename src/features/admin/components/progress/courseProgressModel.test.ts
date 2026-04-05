import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import { ContentJob, JobStepTimelineEntry } from '../../types';
import { deriveCourseProgressModel } from './courseProgressModel';

function makeJob(overrides: Partial<ContentJob> = {}): ContentJob {
  return {
    id: 'job-1',
    status: 'tts_converting',
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
    ttsModel: 'qwen3-base',
    ttsVoice: 'voice-1',
    autoPublish: false,
    createdAt: Timestamp.fromMillis(1),
    updatedAt: Timestamp.fromMillis(1),
    createdBy: 'admin',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<JobStepTimelineEntry>): JobStepTimelineEntry {
  return {
    id: 'entry-1',
    source: 'v2',
    jobId: 'job-1',
    runId: 'job-1-r1',
    stepName: 'synthesize_course_audio_chunk',
    state: 'ready',
    timestamp: Timestamp.fromMillis(1),
    ...overrides,
  };
}

describe('deriveCourseProgressModel', () => {
  it('treats partially completed chunk fan-out as running for the parent shard', () => {
    const job = makeJob();
    const timelineEntries: JobStepTimelineEntry[] = [
      makeEntry({
        id: 'chunk-1-done',
        shardKey: 'M1L-P01',
        state: 'succeeded',
        workerId: 'local-tts-qwen',
        endedAt: Timestamp.fromMillis(20),
        timestamp: Timestamp.fromMillis(20),
      }),
      makeEntry({
        id: 'chunk-2-ready',
        shardKey: 'M1L-P02',
        state: 'ready',
        timestamp: Timestamp.fromMillis(30),
      }),
    ];

    const model = deriveCourseProgressModel(job, timelineEntries);

    expect(model.audioShards.M1L.state).toBe('running');
    expect(model.audioShards.M1L.workerId).toBe('local-tts-qwen');
  });
});
