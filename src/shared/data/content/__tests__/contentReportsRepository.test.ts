import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAddDoc, mockCollection } = vi.hoisted(() => ({
  mockAddDoc: vi.fn(),
  mockCollection: vi.fn((_db, name) => `collection:${name}`),
}));

vi.mock('@/firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  serverTimestamp: () => 'server-ts',
}));

import { reportContent } from '../contentReportsRepository';

describe('contentReportsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates open reports with the expected public fields only', async () => {
    mockAddDoc.mockResolvedValueOnce({ id: 'report-1' });

    const result = await reportContent(
      'user-1',
      'content-1',
      'guided_meditation',
      'audio_issue',
      'The audio stops halfway through.'
    );

    expect(result).toBe(true);
    expect(mockAddDoc).toHaveBeenCalledWith('collection:content_reports', {
      user_id: 'user-1',
      content_id: 'content-1',
      content_type: 'guided_meditation',
      category: 'audio_issue',
      description: 'The audio stops halfway through.',
      status: 'open',
      reported_at: 'server-ts',
    });
  });
});
