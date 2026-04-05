import {
  Timestamp,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/firebase';
import {
  ContentManagerAuditEntry,
  ContentManagerCollection,
  ContentManagerEditableValues,
  ContentManagerSaveResult,
} from '../types';
import { ContentReportStatus } from '@/types';

type UpdateContentMetadataRequest = {
  collection: ContentManagerCollection;
  id: string;
  patch: ContentManagerEditableValues;
  reason: string;
};

type UpdateContentMetadataResponse = {
  ok: boolean;
  changed: boolean;
  changedFields: string[];
};

type UpdateContentReportStatusRequest = {
  reportId: string;
  status: ContentReportStatus;
  resolutionNote?: string | null;
};

type UpdateContentReportStatusResponse = {
  ok: boolean;
  status: ContentReportStatus;
  changed: boolean;
};

const updateContentMetadataCallable = httpsCallable<
  UpdateContentMetadataRequest,
  UpdateContentMetadataResponse
>(functions, 'updateContentMetadata');

const updateContentReportStatusCallable = httpsCallable<
  UpdateContentReportStatusRequest,
  UpdateContentReportStatusResponse
>(functions, 'updateContentReportStatus');

function asTimestamp(value: unknown): Timestamp | undefined {
  return value instanceof Timestamp ? value : undefined;
}

export async function updateContentMetadata(
  collection: ContentManagerCollection,
  id: string,
  patch: ContentManagerEditableValues,
  reason: string
): Promise<ContentManagerSaveResult> {
  const result = await updateContentMetadataCallable({
    collection,
    id,
    patch,
    reason,
  });

  return {
    changed: Boolean(result.data?.changed),
    changedFields: Array.isArray(result.data?.changedFields)
      ? result.data.changedFields
      : [],
  };
}

export async function getContentManagerAuditEntries(
  collectionName: ContentManagerCollection,
  id: string
): Promise<ContentManagerAuditEntry[]> {
  const auditDocId = `${collectionName}__${id}`;
  const entriesRef = collection(db, 'content_audit_logs', auditDocId, 'entries');
  const auditQuery = query(entriesRef, orderBy('createdAt', 'desc'), limit(20));
  const snapshot = await getDocs(auditQuery);

  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data() as Record<string, unknown>;
    return {
      id: docSnapshot.id,
      actorUid: String(data.actorUid || ''),
      actorEmail: data.actorEmail ? String(data.actorEmail) : undefined,
      reason: String(data.reason || ''),
      changedFields: Array.isArray(data.changedFields)
        ? data.changedFields.map((field) => String(field))
        : [],
      before:
        data.before && typeof data.before === 'object'
          ? (data.before as ContentManagerEditableValues)
          : {},
      after:
        data.after && typeof data.after === 'object'
          ? (data.after as ContentManagerEditableValues)
          : {},
      createdAt: asTimestamp(data.createdAt),
    };
  });
}

export async function updateContentReportStatus(
  reportId: string,
  status: ContentReportStatus,
  resolutionNote?: string | null
): Promise<{ status: ContentReportStatus; changed: boolean }> {
  const result = await updateContentReportStatusCallable({
    reportId,
    status,
    resolutionNote,
  });

  return {
    status: result.data?.status || status,
    changed: Boolean(result.data?.changed),
  };
}
