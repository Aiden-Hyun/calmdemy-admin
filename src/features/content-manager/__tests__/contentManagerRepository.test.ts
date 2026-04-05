import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  getMeditations: vi.fn(),
  getMeditationById: vi.fn(),
  getEmergencyMeditations: vi.fn(),
  getEmergencyMeditationById: vi.fn(),
  getCourses: vi.fn(),
  getCourseById: vi.fn(),
  getCourseSessions: vi.fn(),
  getCourseSessionById: vi.fn(),
  getSleepMeditations: vi.fn(),
  getSleepMeditationById: vi.fn(),
  getBedtimeStories: vi.fn(),
  getBedtimeStoryById: vi.fn(),
}));

vi.mock('@features/meditate/data/meditateRepository', () => ({
  getMeditations: repoMocks.getMeditations,
  getMeditationById: repoMocks.getMeditationById,
  getEmergencyMeditations: repoMocks.getEmergencyMeditations,
  getEmergencyMeditationById: repoMocks.getEmergencyMeditationById,
  getCourses: repoMocks.getCourses,
  getCourseById: repoMocks.getCourseById,
  getCourseSessions: repoMocks.getCourseSessions,
  getCourseSessionById: repoMocks.getCourseSessionById,
}));

vi.mock('@features/sleep/data/sleepRepository', () => ({
  getSleepMeditations: repoMocks.getSleepMeditations,
  getSleepMeditationById: repoMocks.getSleepMeditationById,
  getBedtimeStories: repoMocks.getBedtimeStories,
  getBedtimeStoryById: repoMocks.getBedtimeStoryById,
}));

import {
  getContentManagerItemDetail,
  getContentManagerItems,
} from '../data/contentManagerRepository';

describe('contentManagerRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes all six content collections into a mixed summary list', async () => {
    repoMocks.getMeditations.mockResolvedValue([
      {
        id: 'med-1',
        title: 'Calm Breath',
        description: 'A guided meditation',
        duration_minutes: 10,
        audioPath: 'audio/meditation.mp3',
        themes: ['focus'],
        techniques: ['breathing'],
        difficulty_level: 'beginner',
        isFree: true,
      },
    ]);
    repoMocks.getSleepMeditations.mockResolvedValue([
      {
        id: 'sleep-1',
        title: 'Night Reset',
        description: 'Sleep meditation',
        duration_minutes: 15,
        instructor: 'Ava',
        icon: 'moon',
        audioPath: 'audio/sleep.mp3',
        color: '#223344',
      },
    ]);
    repoMocks.getBedtimeStories.mockResolvedValue([
      {
        id: 'story-1',
        title: 'Quiet Forest',
        description: 'A bedtime story',
        narrator: 'Lia',
        duration_minutes: 20,
        category: 'nature',
      },
    ]);
    repoMocks.getEmergencyMeditations.mockResolvedValue([
      {
        id: 'em-1',
        title: 'Panic Reset',
        description: 'Emergency support',
        duration_minutes: 5,
        icon: 'flash',
        color: '#ffcc00',
        audioPath: 'audio/emergency.mp3',
      },
    ]);
    repoMocks.getCourses.mockResolvedValue([
      {
        id: 'course-1',
        code: 'CBT101',
        title: 'CBT Foundations',
        description: 'Course description',
        color: '#112233',
        instructor: 'Sam',
        sessionCount: 1,
        sessions: [],
      },
    ]);
    repoMocks.getCourseSessions.mockResolvedValue([
      {
        id: 'session-1',
        courseId: 'course-1',
        code: 'CBT101M1L',
        title: 'Lesson 1',
        description: 'Course session',
        duration_minutes: 12,
        audioPath: 'audio/session.mp3',
        order: 1,
      },
    ]);

    const results = await getContentManagerItems();

    expect(results).toHaveLength(6);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'guided_meditations',
          title: 'Calm Breath',
          access: 'free',
        }),
        expect.objectContaining({
          collection: 'sleep_meditations',
          title: 'Night Reset',
        }),
        expect.objectContaining({
          collection: 'bedtime_stories',
          title: 'Quiet Forest',
        }),
        expect.objectContaining({
          collection: 'emergency_meditations',
          title: 'Panic Reset',
        }),
        expect.objectContaining({
          collection: 'courses',
          identifier: 'CBT101',
        }),
        expect.objectContaining({
          collection: 'course_sessions',
          identifier: 'CBT101M1L',
          access: 'premium',
        }),
      ])
    );
  });

  it('builds course detail with linked sessions', async () => {
    repoMocks.getCourseById.mockResolvedValue({
      id: 'course-1',
      code: 'CBT101',
      title: 'CBT Foundations',
      description: 'Course description',
      color: '#112233',
      instructor: 'Sam',
      sessionCount: 1,
      sessions: [
        {
          id: 'session-1',
          courseId: 'course-1',
          code: 'CBT101M1L',
          title: 'Lesson 1',
          description: 'Session description',
          duration_minutes: 12,
          audioPath: 'audio/session.mp3',
          order: 1,
        },
      ],
    });

    const detail = await getContentManagerItemDetail('courses', 'course-1');

    expect(detail?.relations).toEqual([
      expect.objectContaining({
        collection: 'course_sessions',
        id: 'session-1',
        code: 'CBT101M1L',
      }),
    ]);
  });

  it('builds course session detail with linked parent course', async () => {
    repoMocks.getCourseSessionById.mockResolvedValue({
      id: 'session-1',
      courseId: 'course-1',
      code: 'CBT101M1L',
      title: 'Lesson 1',
      description: 'Session description',
      duration_minutes: 12,
      audioPath: 'audio/session.mp3',
      order: 1,
    });
    repoMocks.getCourseById.mockResolvedValue({
      id: 'course-1',
      code: 'CBT101',
      title: 'CBT Foundations',
      description: 'Course description',
      color: '#112233',
      instructor: 'Sam',
      sessionCount: 1,
      sessions: [],
    });

    const detail = await getContentManagerItemDetail('course_sessions', 'session-1');

    expect(detail?.relations).toEqual([
      expect.objectContaining({
        collection: 'courses',
        id: 'course-1',
        code: 'CBT101',
      }),
    ]);
    expect(detail?.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Audio Path',
          value: 'audio/session.mp3',
        }),
      ])
    );
  });
});
