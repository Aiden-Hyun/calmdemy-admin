import { describe, expect, it } from 'vitest';
import { filterContentManagerItems } from '../data/contentManagerSearch';
import { ContentManagerItemSummary } from '../types';

const items: ContentManagerItemSummary[] = [
  {
    id: 'm-2',
    collection: 'guided_meditations',
    typeLabel: 'Guided Meditation',
    title: 'Body Scan for Sleep',
    identifier: 'm-2',
    access: 'free',
    previewRoute: { pathname: '/meditation/[id]', params: { id: 'm-2' } },
  },
  {
    id: 'course-1',
    collection: 'courses',
    typeLabel: 'Course',
    title: 'CBT Foundations',
    identifier: 'CBT101',
    code: 'CBT101',
    access: 'free',
    previewRoute: { pathname: '/course/[id]', params: { id: 'course-1' } },
  },
  {
    id: 'session-1',
    collection: 'course_sessions',
    typeLabel: 'Course Session',
    title: 'Grounding Practice',
    identifier: 'CBT101M1L',
    code: 'CBT101M1L',
    access: 'premium',
    previewRoute: { pathname: '/course/session/[id]', params: { id: 'session-1' } },
  },
  {
    id: 'm-1',
    collection: 'guided_meditations',
    typeLabel: 'Guided Meditation',
    title: 'Anxiety Relief',
    identifier: 'm-1',
    access: 'free',
    previewRoute: { pathname: '/meditation/[id]', params: { id: 'm-1' } },
  },
];

describe('filterContentManagerItems', () => {
  it('sorts alphabetically by title and then id when query is empty', () => {
    const results = filterContentManagerItems(items, {
      query: '',
      type: 'all',
      access: 'all',
    });

    expect(results.map((item) => item.title)).toEqual([
      'Anxiety Relief',
      'Body Scan for Sleep',
      'CBT Foundations',
      'Grounding Practice',
    ]);
  });

  it('ranks exact code matches ahead of title matches', () => {
    const results = filterContentManagerItems(items, {
      query: 'cbt101m1l',
      type: 'all',
      access: 'all',
    });

    expect(results[0]?.id).toBe('session-1');
  });

  it('places title prefix matches ahead of substring matches', () => {
    const results = filterContentManagerItems(
      [
        {
          ...items[0],
          id: 'm-3',
          title: 'Sleep Reset',
        },
        {
          ...items[1],
          id: 'm-4',
          collection: 'sleep_meditations',
          typeLabel: 'Sleep Meditation',
          title: 'Deep Sleep Reset',
          previewRoute: { pathname: '/sleep/meditation/[id]', params: { id: 'm-4' } },
        },
      ],
      {
        query: 'sleep',
        type: 'all',
        access: 'all',
      }
    );

    expect(results.map((item) => item.title)).toEqual([
      'Sleep Reset',
      'Deep Sleep Reset',
    ]);
  });

  it('applies type and access filters before ranking', () => {
    const results = filterContentManagerItems(items, {
      query: '',
      type: 'course_sessions',
      access: 'premium',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('session-1');
  });
});
