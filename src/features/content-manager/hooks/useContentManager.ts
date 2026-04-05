import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  requestContentThumbnailGeneration,
  requestCourseThumbnailGeneration,
  regenerateCourseSessions,
} from '@features/admin/data/adminRepository';
import {
  buildEditFormValues,
  evaluateMetadataForm,
} from '../data/contentManagerEditConfig';
import {
  getContentManagerAuditEntries,
  updateContentMetadata,
  updateContentReportStatus,
} from '../data/contentManagerAdminRepository';
import {
  getContentManagerItemDetail,
  getContentManagerItems,
} from '../data/contentManagerRepository';
import {
  getContentManagerRepairActionAvailability,
  getContentManagerReports,
  getContentManagerReportsForItem,
  getOpenContentReportsCount,
} from '../data/contentManagerReportsRepository';
import { filterContentManagerItems } from '../data/contentManagerSearch';
import { filterContentManagerReports } from '../data/contentManagerReportsSearch';
import {
  CONTENT_MANAGER_DEFAULT_FILTERS,
  CONTENT_MANAGER_DEFAULT_REPORT_FILTERS,
  ContentManagerAuditEntry,
  ContentManagerCollection,
  ContentManagerEditFormValues,
  ContentManagerFilterState,
  ContentManagerItemDetail,
  ContentManagerItemSummary,
  ContentManagerRepairActionAvailability,
  ContentManagerReportSummary,
  ContentManagerReportsFilterState,
} from '../types';
import { ContentReportStatus } from '@/types';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function useRefreshOnFocus(
  load: () => Promise<unknown> | void,
  hasLoadedRef: { current: boolean }
) {
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedRef.current) {
        return;
      }
      load();
    }, [hasLoadedRef, load])
  );
}

export function useContentManagerCatalog() {
  const [items, setItems] = useState<ContentManagerItemSummary[]>([]);
  const [filters, setFilters] = useState<ContentManagerFilterState>(
    CONTENT_MANAGER_DEFAULT_FILTERS
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const nextItems = await getContentManagerItems();
      setItems(nextItems);
      setError(null);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load content manager items.'));
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load('initial');
  }, [load]);

  useRefreshOnFocus(() => load('refresh'), hasLoadedRef);

  const filteredItems = useMemo(
    () => filterContentManagerItems(items, filters),
    [items, filters]
  );

  const setQuery = useCallback((query: string) => {
    setFilters((current) => ({ ...current, query }));
  }, []);

  const setType = useCallback((type: ContentManagerFilterState['type']) => {
    setFilters((current) => ({ ...current, type }));
  }, []);

  const setAccess = useCallback((access: ContentManagerFilterState['access']) => {
    setFilters((current) => ({ ...current, access }));
  }, []);

  const setThumbnail = useCallback((thumbnail: ContentManagerFilterState['thumbnail']) => {
    setFilters((current) => ({ ...current, thumbnail }));
  }, []);

  return {
    items,
    filteredItems,
    filters,
    isLoading,
    isRefreshing,
    error,
    refresh: () => load('refresh'),
    setQuery,
    setType,
    setAccess,
    setThumbnail,
  };
}

export function useContentManagerReportsSummary() {
  const [openCount, setOpenCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const count = await getOpenContentReportsCount();
      setOpenCount(count);
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRefreshOnFocus(load, hasLoadedRef);

  return {
    openCount,
    isLoading,
    refresh: load,
  };
}

export function useContentManagerReportsInbox() {
  const [reports, setReports] = useState<ContentManagerReportSummary[]>([]);
  const [filters, setFilters] = useState<ContentManagerReportsFilterState>(
    CONTENT_MANAGER_DEFAULT_REPORT_FILTERS
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const nextReports = await getContentManagerReports();
      setReports(nextReports);
      setError(null);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Unable to load content reports.'));
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load('initial');
  }, [load]);

  useRefreshOnFocus(() => load('refresh'), hasLoadedRef);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [message]);

  const filteredReports = useMemo(
    () => filterContentManagerReports(reports, filters),
    [reports, filters]
  );

  const updateStatus = useCallback(
    async (reportId: string, status: ContentReportStatus, resolutionNote?: string) => {
      setUpdatingReportId(reportId);
      setError(null);
      try {
        await updateContentReportStatus(reportId, status, resolutionNote?.trim() || null);
        setMessage(status === 'resolved' ? 'Report resolved.' : 'Report reopened.');
        await load('refresh');
      } catch (updateError) {
        setError(getErrorMessage(updateError, 'Unable to update report status.'));
      } finally {
        setUpdatingReportId(null);
      }
    },
    [load]
  );

  return {
    reports,
    filteredReports,
    filters,
    openCount: reports.filter((report) => report.status === 'open').length,
    isLoading,
    isRefreshing,
    updatingReportId,
    error,
    message,
    refresh: () => load('refresh'),
    setQuery: (query: string) =>
      setFilters((current) => ({
        ...current,
        query,
      })),
    setStatus: (status: ContentManagerReportsFilterState['status']) =>
      setFilters((current) => ({
        ...current,
        status,
      })),
    setType: (type: ContentManagerReportsFilterState['type']) =>
      setFilters((current) => ({
        ...current,
        type,
      })),
    setCategory: (category: ContentManagerReportsFilterState['category']) =>
      setFilters((current) => ({
        ...current,
        category,
      })),
    updateStatus,
  };
}

export function useContentManagerDetail(
  collection: ContentManagerCollection | null,
  id: string | null,
  selectedReportId?: string | null
) {
  const [item, setItem] = useState<ContentManagerItemDetail | null>(null);
  const [history, setHistory] = useState<ContentManagerAuditEntry[]>([]);
  const [reports, setReports] = useState<ContentManagerReportSummary[]>([]);
  const [repairAvailability, setRepairAvailability] =
    useState<ContentManagerRepairActionAvailability | null>(null);
  const [formValues, setFormValues] = useState<ContentManagerEditFormValues>({});
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRepairing, setIsRepairing] = useState<string | null>(null);
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const isEditingRef = useRef(false);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  const resetFormState = useCallback((nextItem: ContentManagerItemDetail | null) => {
    setFormValues(
      nextItem ? buildEditFormValues(nextItem.collection, nextItem.editableValues) : {}
    );
    setReason('');
    setFieldErrors({});
    setReasonError(undefined);
    setSaveError(null);
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'refresh') => {
      if (!collection || !id) {
        setItem(null);
        setHistory([]);
        setReports([]);
        setRepairAvailability(null);
        resetFormState(null);
        setError('Missing content identifier.');
        setIsLoading(false);
        setIsRefreshing(false);
        return null;
      }

      if (mode === 'initial') {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const [nextItem, nextHistory, nextReports] = await Promise.all([
          getContentManagerItemDetail(collection, id),
          getContentManagerAuditEntries(collection, id),
          getContentManagerReportsForItem(collection, id),
        ]);

        if (!nextItem) {
          setItem(null);
          setHistory([]);
          setReports([]);
          setRepairAvailability(null);
          resetFormState(null);
          setError('Content not found.');
        } else {
          const nextRepairAvailability = await getContentManagerRepairActionAvailability(nextItem);
          setItem(nextItem);
          setHistory(nextHistory);
          setReports(nextReports);
          setRepairAvailability(nextRepairAvailability);
          setError(null);
          if (!isEditingRef.current || mode === 'initial') {
            resetFormState(nextItem);
          }
        }
        return nextItem;
      } catch (loadError) {
        setError(getErrorMessage(loadError, 'Unable to load content detail.'));
        return null;
      } finally {
        hasLoadedRef.current = true;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [collection, id, resetFormState]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  useRefreshOnFocus(() => load('refresh'), hasLoadedRef);

  useEffect(() => {
    if (!saveMessage) {
      return;
    }
    const timer = setTimeout(() => setSaveMessage(null), 2400);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  useEffect(() => {
    if (!repairMessage) {
      return;
    }
    const timer = setTimeout(() => setRepairMessage(null), 2400);
    return () => clearTimeout(timer);
  }, [repairMessage]);

  useEffect(() => {
    if (!reportMessage) {
      return;
    }
    const timer = setTimeout(() => setReportMessage(null), 2400);
    return () => clearTimeout(timer);
  }, [reportMessage]);

  const validation = useMemo(() => {
    if (!item) {
      return {
        patch: {},
        normalizedValues: {},
        fieldErrors: {},
        reasonError: undefined,
        isDirty: false,
        isValid: false,
      };
    }

    return evaluateMetadataForm(item.collection, item.editableValues, formValues, reason);
  }, [formValues, item, reason]);

  const selectedReport = useMemo(() => {
    if (!selectedReportId) {
      return null;
    }
    return reports.find((report) => report.id === selectedReportId) || null;
  }, [reports, selectedReportId]);

  const startEditing = useCallback(() => {
    if (!item) return;
    resetFormState(item);
    setSaveMessage(null);
    setIsEditing(true);
  }, [item, resetFormState]);

  const cancelEditing = useCallback(() => {
    resetFormState(item);
    setIsEditing(false);
  }, [item, resetFormState]);

  const setFieldValue = useCallback((fieldName: string, value: string | string[]) => {
    setFormValues((current) => ({ ...current, [fieldName]: value }));
    setFieldErrors((current) => {
      if (!(fieldName in current)) return current;
      const next = { ...current };
      delete next[fieldName];
      return next;
    });
    setSaveError(null);
  }, []);

  const toggleFieldOption = useCallback((fieldName: string, optionValue: string) => {
    setFormValues((current) => {
      const existing = Array.isArray(current[fieldName]) ? current[fieldName] : [];
      const nextValues = existing.includes(optionValue)
        ? existing.filter((value) => value !== optionValue)
        : [...existing, optionValue];
      return {
        ...current,
        [fieldName]: nextValues,
      };
    });
    setFieldErrors((current) => {
      if (!(fieldName in current)) return current;
      const next = { ...current };
      delete next[fieldName];
      return next;
    });
    setSaveError(null);
  }, []);

  const setChangeReason = useCallback((nextReason: string) => {
    setReason(nextReason);
    setReasonError(undefined);
    setSaveError(null);
  }, []);

  const saveMetadata = useCallback(async () => {
    if (!item) return;

    const nextValidation = evaluateMetadataForm(
      item.collection,
      item.editableValues,
      formValues,
      reason
    );

    setFieldErrors(nextValidation.fieldErrors);
    setReasonError(nextValidation.reasonError);

    if (!nextValidation.isDirty) {
      setSaveError('Make a change before saving.');
      return;
    }

    if (!nextValidation.isValid) {
      setSaveError('Fix the highlighted fields before saving.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const result = await updateContentMetadata(
        item.collection,
        item.id,
        nextValidation.patch,
        reason.trim()
      );
      const nextItem = await load('refresh');
      setIsEditing(false);
      isEditingRef.current = false;
      resetFormState(nextItem || null);
      setSaveMessage(
        result.changed
          ? `Saved ${result.changedFields.length} field${result.changedFields.length === 1 ? '' : 's'}.`
          : 'No metadata changes were needed.'
      );
    } catch (saveMetadataError) {
      setSaveError(getErrorMessage(saveMetadataError, 'Unable to save content metadata.'));
    } finally {
      setIsSaving(false);
    }
  }, [formValues, item, load, reason, resetFormState]);

  const updateReport = useCallback(
    async (reportId: string, status: ContentReportStatus, resolutionNote?: string) => {
      setUpdatingReportId(reportId);
      setReportError(null);
      try {
        await updateContentReportStatus(reportId, status, resolutionNote?.trim() || null);
        setReportMessage(status === 'resolved' ? 'Report resolved.' : 'Report reopened.');
        await load('refresh');
      } catch (updateError) {
        setReportError(getErrorMessage(updateError, 'Unable to update report status.'));
      } finally {
        setUpdatingReportId(null);
      }
    },
    [load]
  );

  const runRepairAction = useCallback(
    async (action: 'audio_only' | 'script_and_audio' | 'thumbnail') => {
      if (!item || !repairAvailability?.job) {
        setRepairError('No supporting course job is available for this action.');
        return;
      }

      setIsRepairing(action);
      setRepairError(null);
      setRepairMessage(null);

      try {
        if (action === 'thumbnail') {
          if (repairAvailability.job.contentType === 'course') {
            await requestCourseThumbnailGeneration(repairAvailability.job);
          } else {
            await requestContentThumbnailGeneration(repairAvailability.job);
          }
          setRepairMessage('Thumbnail generation requested.');
        } else {
          const sessionCode = repairAvailability.sessionCode || item.code;
          if (!sessionCode) {
            throw new Error('Session code is required for course-session regeneration.');
          }
          await regenerateCourseSessions(repairAvailability.job, {
            mode: action,
            targetSessionCodes: [sessionCode],
          });
          setRepairMessage(
            action === 'audio_only'
              ? 'Audio regeneration requested.'
              : 'Script and audio regeneration requested.'
          );
        }
      } catch (repairActionError) {
        setRepairError(getErrorMessage(repairActionError, 'Unable to start repair action.'));
      } finally {
        setIsRepairing(null);
      }
    },
    [item, repairAvailability]
  );

  return {
    item,
    history,
    reports,
    selectedReport,
    repairAvailability,
    formValues,
    reason,
    fieldErrors,
    reasonError,
    isEditing,
    isLoading,
    isRefreshing,
    isSaving,
    isRepairing,
    updatingReportId,
    error,
    saveError,
    saveMessage,
    repairError,
    repairMessage,
    reportError,
    reportMessage,
    isDirty: validation.isDirty,
    isValid: validation.isValid,
    refresh: () => load('refresh'),
    startEditing,
    cancelEditing,
    setFieldValue,
    toggleFieldOption,
    setReason: setChangeReason,
    saveMetadata,
    updateReportStatus: updateReport,
    runRepairAction,
  };
}
