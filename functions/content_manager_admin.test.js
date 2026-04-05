import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createUpdateContentMetadataHandler,
  createUpdateContentReportStatusHandler,
} = require('./content_manager_admin');

class MockHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createFirestoreHarness({ userDoc, contentDoc, reportDoc }) {
  const docs = new Map([
    ['users/admin-1', userDoc],
    ['guided_meditations/item-1', contentDoc],
  ]);
  if (reportDoc) {
    docs.set('content_reports/report-1', reportDoc);
  }
  const batchWrites = [];
  let generatedId = 0;
  const serverTimestamp = { __type: 'serverTimestamp' };

  function createDocSnapshot(path) {
    const entry = docs.get(path);
    return {
      exists: Boolean(entry?.exists),
      data: () => (entry?.exists ? entry.data : undefined),
    };
  }

  function createCollectionRef(segments) {
    return {
      doc(id) {
        const docId = id || `generated-${++generatedId}`;
        return createDocRef([...segments, docId]);
      },
    };
  }

  function createDocRef(segments) {
    const path = segments.join('/');
    return {
      id: segments[segments.length - 1],
      path,
      get: async () => createDocSnapshot(path),
      set: vi.fn(async (data, options) => {
        batchWrites.push({ path, data, options });
      }),
      collection: (name) => createCollectionRef([...segments, name]),
    };
  }

  const db = {
    collection: (name) => createCollectionRef([name]),
    batch() {
      const writes = [];
      return {
        set(ref, data, options) {
          writes.push({ path: ref.path, data, options });
        },
        commit: vi.fn(async () => {
          batchWrites.push(...writes);
        }),
      };
    },
  };

  const firestore = () => db;
  firestore.FieldValue = {
    serverTimestamp: () => serverTimestamp,
  };

  return {
    adminLib: { firestore },
    batchWrites,
    serverTimestamp,
  };
}

const functionsLib = {
  https: {
    HttpsError: MockHttpsError,
  },
};

describe('content_manager_admin callable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets an admin update allowed metadata and records an audit entry', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'stored-admin@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: {
          title: 'Calm Breath',
          description: 'A grounding reset.',
          duration_minutes: 10,
          themes: ['focus'],
          techniques: ['breathing'],
          difficulty_level: 'beginner',
          instructor: 'Ava',
        },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    const result = await handler(
      {
        collection: 'guided_meditations',
        id: 'item-1',
        patch: { title: 'Updated Breath' },
        reason: 'Fixing metadata copy',
      },
      {
        auth: {
          uid: 'admin-1',
          token: { email: 'admin@calmdemy.app' },
        },
      }
    );

    expect(result).toEqual({
      ok: true,
      changed: true,
      changedFields: ['title'],
    });
    expect(harness.batchWrites).toHaveLength(3);
    expect(harness.batchWrites[0]).toEqual({
      path: 'guided_meditations/item-1',
      data: {
        title: 'Updated Breath',
        updatedAt: harness.serverTimestamp,
      },
      options: { merge: true },
    });
    expect(harness.batchWrites[1]).toEqual({
      path: 'content_audit_logs/guided_meditations__item-1',
      data: {
        collection: 'guided_meditations',
        contentId: 'item-1',
        lastEditedAt: harness.serverTimestamp,
      },
      options: { merge: true },
    });
    expect(harness.batchWrites[2].path).toBe(
      'content_audit_logs/guided_meditations__item-1/entries/generated-1'
    );
    expect(harness.batchWrites[2].data).toMatchObject({
      actorUid: 'admin-1',
      actorEmail: 'admin@calmdemy.app',
      reason: 'Fixing metadata copy',
      changedFields: ['title'],
      before: { title: 'Calm Breath' },
      after: { title: 'Updated Breath' },
      createdAt: harness.serverTimestamp,
    });
  });

  it('rejects non-admin callers', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'user', email: 'user@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: { title: 'Calm Breath' },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          collection: 'guided_meditations',
          id: 'item-1',
          patch: { title: 'Updated Breath' },
          reason: 'Fixing metadata copy',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects unknown collections', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: { title: 'Calm Breath' },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          collection: 'unknown_collection',
          id: 'item-1',
          patch: { title: 'Updated Breath' },
          reason: 'Fixing metadata copy',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects unknown editable fields', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: { title: 'Calm Breath' },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          collection: 'guided_meditations',
          id: 'item-1',
          patch: { audioPath: 'audio/new.mp3' },
          reason: 'Should not be editable',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects invalid enum values', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: {
          title: 'Calm Breath',
          description: 'A grounding reset.',
          duration_minutes: 10,
          difficulty_level: 'beginner',
        },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          collection: 'guided_meditations',
          id: 'item-1',
          patch: { difficulty_level: 'expert' },
          reason: 'Setting an unsupported difficulty',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects invalid numeric values', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: {
          title: 'Calm Breath',
          description: 'A grounding reset.',
          duration_minutes: 10,
        },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          collection: 'guided_meditations',
          id: 'item-1',
          patch: { duration_minutes: 0 },
          reason: 'Setting an invalid duration',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects empty reasons', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: { title: 'Calm Breath' },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          collection: 'guided_meditations',
          id: 'item-1',
          patch: { title: 'Updated Breath' },
          reason: '   ',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns a no-change response without writing audit history when nothing changed', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: true,
        data: {
          title: 'Calm Breath',
          description: 'A grounding reset.',
        },
      },
    });

    const handler = createUpdateContentMetadataHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    const result = await handler(
      {
        collection: 'guided_meditations',
        id: 'item-1',
        patch: { title: 'Calm Breath' },
        reason: 'No actual change',
      },
      { auth: { uid: 'admin-1', token: {} } }
    );

    expect(result).toEqual({
      ok: true,
      changed: false,
      changedFields: [],
    });
    expect(harness.batchWrites).toHaveLength(0);
  });

  it('lets an admin resolve a report and stores resolver metadata', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'stored-admin@calmdemy.app' },
      },
      contentDoc: {
        exists: false,
      },
      reportDoc: {
        exists: true,
        data: {
          status: 'open',
          resolution_note: null,
        },
      },
    });

    const handler = createUpdateContentReportStatusHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    const result = await handler(
      {
        reportId: 'report-1',
        status: 'resolved',
        resolutionNote: 'Regenerated the audio and verified playback.',
      },
      {
        auth: {
          uid: 'admin-1',
          token: { email: 'admin@calmdemy.app' },
        },
      }
    );

    expect(result).toEqual({
      ok: true,
      status: 'resolved',
      changed: true,
    });
    expect(harness.batchWrites).toEqual([
      {
        path: 'content_reports/report-1',
        data: {
          status: 'resolved',
          resolution_note: 'Regenerated the audio and verified playback.',
          resolved_at: harness.serverTimestamp,
          resolved_by_uid: 'admin-1',
          resolved_by_email: 'admin@calmdemy.app',
        },
        options: { merge: true },
      },
    ]);
  });

  it('lets an admin reopen a resolved report and clears resolver metadata', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'stored-admin@calmdemy.app' },
      },
      contentDoc: {
        exists: false,
      },
      reportDoc: {
        exists: true,
        data: {
          status: 'resolved',
          resolution_note: 'Already handled.',
          resolved_by_uid: 'admin-1',
          resolved_by_email: 'admin@calmdemy.app',
        },
      },
    });

    const handler = createUpdateContentReportStatusHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    const result = await handler(
      {
        reportId: 'report-1',
        status: 'open',
      },
      {
        auth: {
          uid: 'admin-1',
          token: { email: 'admin@calmdemy.app' },
        },
      }
    );

    expect(result).toEqual({
      ok: true,
      status: 'open',
      changed: true,
    });
    expect(harness.batchWrites).toEqual([
      {
        path: 'content_reports/report-1',
        data: {
          status: 'open',
          resolution_note: null,
          resolved_at: null,
          resolved_by_uid: null,
          resolved_by_email: null,
        },
        options: { merge: true },
      },
    ]);
  });

  it('rejects non-admin callers when updating report status', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'user', email: 'user@calmdemy.app' },
      },
      contentDoc: {
        exists: false,
      },
      reportDoc: {
        exists: true,
        data: {
          status: 'open',
        },
      },
    });

    const handler = createUpdateContentReportStatusHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          reportId: 'report-1',
          status: 'resolved',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects invalid report statuses', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: false,
      },
      reportDoc: {
        exists: true,
        data: {
          status: 'open',
        },
      },
    });

    const handler = createUpdateContentReportStatusHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    await expect(
      handler(
        {
          reportId: 'report-1',
          status: 'closed',
        },
        { auth: { uid: 'admin-1', token: {} } }
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns a no-change response when the report already has the requested status', async () => {
    const harness = createFirestoreHarness({
      userDoc: {
        exists: true,
        data: { role: 'admin', email: 'admin@calmdemy.app' },
      },
      contentDoc: {
        exists: false,
      },
      reportDoc: {
        exists: true,
        data: {
          status: 'resolved',
        },
      },
    });

    const handler = createUpdateContentReportStatusHandler({
      adminLib: harness.adminLib,
      functionsLib,
    });

    const result = await handler(
      {
        reportId: 'report-1',
        status: 'resolved',
      },
      { auth: { uid: 'admin-1', token: {} } }
    );

    expect(result).toEqual({
      ok: true,
      status: 'resolved',
      changed: false,
    });
    expect(harness.batchWrites).toHaveLength(0);
  });
});
