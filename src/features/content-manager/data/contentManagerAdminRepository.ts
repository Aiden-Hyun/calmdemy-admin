/**
 * ARCHITECTURAL ROLE:
 * Cloud Function client for write operations (mutations). Encapsulates the command pattern for
 * mutations: updateContentMetadata (PATCH), updateContentReportStatus (state transition).
 * Separates read operations (contentManagerRepository) from writes (this module).
 *
 * DESIGN PATTERNS:
 * - **Command Pattern**: Each public function represents a command (updateContentMetadata, updateContentReportStatus)
 *   with typed request/response envelopes.
 * - **Mutation Wrapper**: Isolates Firebase Cloud Function calls; single point of change if backend endpoint changes.
 * - **Type-Safe RPC**: HTTP Callable functions are typed with generics for request and response payloads,
 *   providing compile-time type safety across the RPC boundary.
 * - **Audit Trail**: updateContentMetadata includes a 'reason' field, enabling audit logging on the backend
 *   (stored in content_audit_logs Firestore collection).
 * - **Audit Query Pattern**: getContentManagerAuditEntries() reads the audit log subcollection in a reverse-chronological
 *   order (orderBy createdAt desc, limit 20), showing recent changes to an item.
 *
 * KEY OPERATIONS:
 * - updateContentMetadata(): Patch item fields, return which fields actually changed (idempotency).
 * - getContentManagerAuditEntries(): Fetch change history for an item (before/after values, actor, reason).
 * - updateContentReportStatus(): Transition report state (open → resolved), optionally record resolution note.
 *
 * SECURITY:
 * - Cloud Functions enforce auth (custom claims), not exposed on client
 * - Audit log is server-generated (not trusted client data)
 * - All mutations go through backend validation before Firestore writes
 *
 * CONSUMERS:
 * - useContentManagerDetail hook for save and audit UI
 * - useContentManagerReportsInbox hook for report status updates
 */

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

/** Request envelope for updateContentMetadata Cloud Function. */
type UpdateContentMetadataRequest = {
  collection: ContentManagerCollection;
  id: string;
  patch: ContentManagerEditableValues;
  reason: string;
};

/** Response envelope from updateContentMetadata Cloud Function. */
type UpdateContentMetadataResponse = {
  ok: boolean;
  changed: boolean;
  changedFields: string[];
};

/** Request envelope for updateContentReportStatus Cloud Function. */
type UpdateContentReportStatusRequest = {
  reportId: string;
  status: ContentReportStatus;
  resolutionNote?: string | null;
};

/** Response envelope from updateContentReportStatus Cloud Function. */
type UpdateContentReportStatusResponse = {
  ok: boolean;
  status: ContentReportStatus;
  changed: boolean;
};

/** Typed Cloud Function reference for metadata updates with audit trail. */
const updateContentMetadataCallable = httpsCallable<
  UpdateContentMetadataRequest,
  UpdateContentMetadataResponse
>(functions, 'updateContentMetadata');

/** Typed Cloud Function reference for report status transitions. */
const updateContentReportStatusCallable = httpsCallable<
  UpdateContentReportStatusRequest,
  UpdateContentReportStatusResponse
>(functions, 'updateContentReportStatus');

/**
 * Type guard to safely extract Firestore Timestamp from unknown value.
 * Used during document deserialization when Firestore SDK returns Timestamp objects.
 * Enables type-safe coercion without runtime errors if value isn't actually a Timestamp.
 */
function asTimestamp(value: unknown): Timestamp | undefined {
  return value instanceof Timestamp ? value : undefined;
}

/**
 * Sends a metadata patch to the backend via Cloud Function.
 * The backend validates the patch, applies only changed fields, and records an audit entry.
 *
 * IDEMPOTENCY:
 * - Backend compares before/after; only changed fields are written to Firestore.
 * - changedFields array lets UI report "saved 3 fields" even if patch included more.
 * - If patch contains only current values, changed=false and changedFields=[].
 *
 * AUDIT:
 * - Backend stores the change: {before values, after values, reason, actorUid, timestamp}
 * - Creates/updates a subcollection entry at content_audit_logs/{collection}_{id}/entries/{entryId}
 * - Audit entries retrieved separately via getContentManagerAuditEntries()
 *
 * ERROR HANDLING:
 * - Throws on network error or backend validation error (consumed by hook's try-catch)
 * - No retry logic here; caller (useContentManagerDetail) decides on retry strategy
 *
 * @param collection - Content collection type (validates Cloud Function knows this collection)
 * @param id - Document ID to update
 * @param patch - Fields to update; null values are preserved (not deleted)
 * @param reason - Admin-facing reason for change (audit trail context)
 * @returns Save result indicating which fields actually changed
 */
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

/**
 * Retrieves the change history for a single content item.
 * Uses Firestore subcollection query: content_audit_logs/{collection}_{id}/entries
 *
 * QUERY STRUCTURE:
 * - Subcollection pattern: document ID is {collection}__${id} (e.g., guided_meditations__abc123)
 * - Orders by createdAt desc (newest first) for reverse-chronological timeline
 * - Limits to 20 most recent entries (pagination not implemented; UI shows recent changes)
 * - Each entry contains before/after field values, change reason, and actor metadata
 *
 * NORMALIZATION:
 * - Coerces string fields (actorUid, reason, changedFields array)
 * - Safely extracts Timestamp objects or undefined if missing
 * - Defaults to empty objects/arrays on missing optional data
 * - Preserves before/after objects as-is for comparison display
 *
 * @param collectionName - Content type (e.g., 'courses')
 * @param id - Document ID (e.g., course_123)
 * @returns Array of audit entries, newest first
 */
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

/**
 * Transitions a content report between open and resolved states.
 * Part of the content moderation workflow: admin reviews report → resolves with optional note.
 *
 * STATE MACHINE:
 * - open → resolved: Report is addressed, content is OK or removed, admin adds resolution context
 * - resolved → open: Report is reopened (e.g., admin misjudged, community appeal) [not enforced in UI yet]
 *
 * BACKEND SIDE EFFECTS:
 * - Updates report.status in Firestore content_reports collection
 * - Sets report.resolved_at = now() (Firestore server timestamp)
 * - Sets report.resolved_by_uid = auth.uid (from Cloud Function context)
 * - Sets report.resolution_note = resolutionNote (admin's explanation to user if needed)
 * - Triggers post-resolution webhooks (e.g., notify reporter, log to moderation DB)
 *
 * IDEMPOTENCY:
 * - If report already in target status, changed=false (already transitioned)
 * - Idempotent re-calls don't duplicate side effects
 *
 * @param reportId - The Firestore document ID of the content_report
 * @param status - Target status ('open' or 'resolved')
 * @param resolutionNote - Optional explanation (max length enforced on backend), null to clear
 * @returns New status and flag indicating if state actually changed
 */
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
