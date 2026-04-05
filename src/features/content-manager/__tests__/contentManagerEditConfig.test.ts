import { describe, expect, it } from 'vitest';
import {
  buildEditableValues,
  evaluateMetadataForm,
} from '../data/contentManagerEditConfig';

describe('contentManagerEditConfig', () => {
  it('only exposes the editable course session fields', () => {
    const values = buildEditableValues('course_sessions', {
      title: 'Lesson 1',
      description: 'Grounding practice',
      duration_minutes: 12,
      courseId: 'course-1',
      code: 'CBT101M1L',
      order: 1,
    });

    expect(values).toEqual({
      title: 'Lesson 1',
      description: 'Grounding practice',
      duration_minutes: 12,
    });
  });

  it('filters guided meditation multiselect values to known enums', () => {
    const values = buildEditableValues('guided_meditations', {
      title: 'Calm Breath',
      description: 'Reset your focus',
      duration_minutes: 10,
      themes: ['focus', 'not-real'],
      techniques: ['breathing', 'imaginary'],
      difficulty_level: 'beginner',
    });

    expect(values.themes).toEqual(['focus']);
    expect(values.techniques).toEqual(['breathing']);
  });

  it('rejects non-positive duration values', () => {
    const result = evaluateMetadataForm(
      'course_sessions',
      {
        title: 'Lesson 1',
        description: 'Grounding practice',
        duration_minutes: 12,
      },
      {
        title: 'Lesson 1',
        description: 'Grounding practice',
        duration_minutes: '0',
      },
      'Fixing runtime'
    );

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.duration_minutes).toBe('Enter a positive whole number.');
  });

  it('rejects invalid bedtime story categories', () => {
    const result = evaluateMetadataForm(
      'bedtime_stories',
      {
        title: 'Quiet Forest',
        description: 'A calm walk through the woods.',
        duration_minutes: 20,
        thumbnail_url: null,
        narrator: 'Lia',
        category: 'nature',
      },
      {
        title: 'Quiet Forest',
        description: 'A calm walk through the woods.',
        duration_minutes: '20',
        thumbnail_url: '',
        narrator: 'Lia',
        category: 'mystery',
      },
      'Correcting taxonomy'
    );

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.category).toBe('Choose a valid category.');
  });
});
