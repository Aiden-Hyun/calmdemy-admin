import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';
import {
  formatEditableValue,
  getContentManagerFieldLabel,
} from '../data/contentManagerEditConfig';
import { ContentManagerReportCard } from '../components/ContentManagerReportCard';
import {
  ContentManagerAuditEntry,
  ContentManagerEditFieldDefinition,
  ContentManagerEditFormValue,
  ContentManagerItemDetail,
  isContentManagerCollection,
} from '../types';
import { useContentManagerDetail } from '../hooks/useContentManager';

function formatDuration(durationMinutes?: number): string {
  if (!durationMinutes || durationMinutes <= 0) {
    return 'Unknown';
  }
  return `${durationMinutes} min`;
}

function formatAuditTimestamp(entry: ContentManagerAuditEntry): string {
  const date = entry.createdAt?.toDate?.();
  if (!date) {
    return 'Just now';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getAuditActorLabel(entry: ContentManagerAuditEntry): string {
  const email = String(entry.actorEmail || '').trim();
  if (email) return email;
  const uid = String(entry.actorUid || '').trim();
  return uid || 'Unknown admin';
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = require('expo-clipboard');
    if (clipboard?.setStringAsync) {
      await clipboard.setStringAsync(text);
      return true;
    }
  } catch {
    // Optional dependency not installed.
  }

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  return false;
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function MetadataRows({ item }: { item: ContentManagerItemDetail }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!item.metadata.length) {
    return <Text style={styles.emptyMeta}>No metadata available.</Text>;
  }

  return (
    <>
      {item.metadata.map((field) => (
        <View key={`${field.label}:${field.value}`} style={styles.dataRow}>
          <Text style={styles.dataLabel}>{field.label}</Text>
          <Text style={[styles.dataValue, field.monospace && styles.dataValueMonospace]}>
            {field.value}
          </Text>
        </View>
      ))}
    </>
  );
}

function MetadataFieldEditor({
  field,
  value,
  error,
  onChangeField,
  onToggleOption,
}: {
  field: ContentManagerEditFieldDefinition;
  value: ContentManagerEditFormValue | undefined;
  error?: string;
  onChangeField: (fieldName: string, value: string | string[]) => void;
  onToggleOption: (fieldName: string, optionValue: string) => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const renderOptions = () => {
    const selectedValues = Array.isArray(value) ? value : [];
    const selectedValue = !Array.isArray(value) ? String(value || '') : '';

    return (
      <View style={styles.optionGroup}>
        {(field.options || []).map((option) => {
          const isSelected =
            field.type === 'multiselect'
              ? selectedValues.includes(option.value)
              : selectedValue === option.value;

          return (
            <Pressable
              key={option.value}
              testID={`content-manager-field-${field.name}-option-${option.value}`}
              onPress={() =>
                field.type === 'multiselect'
                  ? onToggleOption(field.name, option.value)
                  : onChangeField(field.name, option.value)
              }
              style={({ pressed }) => [
                styles.optionChip,
                isSelected && styles.optionChipSelected,
                pressed && { opacity: 0.88 },
              ]}
            >
              <Text
                style={[
                  styles.optionChipText,
                  isSelected && styles.optionChipTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>
        {field.label}
        {field.required ? ' *' : ''}
      </Text>

      {field.type === 'select' || field.type === 'multiselect' ? (
        renderOptions()
      ) : (
        <TextInput
          testID={`content-manager-field-${field.name}`}
          value={Array.isArray(value) ? value.join(', ') : String(value || '')}
          onChangeText={(text) => onChangeField(field.name, text)}
          placeholder={field.placeholder || field.label}
          placeholderTextColor={theme.colors.textMuted}
          multiline={field.type === 'textarea'}
          numberOfLines={field.type === 'textarea' ? 4 : 1}
          keyboardType={field.type === 'number' ? 'number-pad' : 'default'}
          style={[
            styles.textInput,
            field.type === 'textarea' && styles.textAreaInput,
            error && styles.textInputError,
          ]}
        />
      )}

      {field.helperText ? <Text style={styles.helperText}>{field.helperText}</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function EditMetadataCard({
  item,
  formValues,
  reason,
  fieldErrors,
  reasonError,
  isDirty,
  isValid,
  isSaving,
  saveError,
  onChangeField,
  onToggleOption,
  onChangeReason,
  onCancel,
  onSave,
}: {
  item: ContentManagerItemDetail;
  formValues: Record<string, ContentManagerEditFormValue>;
  reason: string;
  fieldErrors: Record<string, string>;
  reasonError?: string;
  isDirty: boolean;
  isValid: boolean;
  isSaving: boolean;
  saveError?: string | null;
  onChangeField: (fieldName: string, value: string | string[]) => void;
  onToggleOption: (fieldName: string, optionValue: string) => void;
  onChangeReason: (reason: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <>
      {item.editableFields.map((field) => (
        <MetadataFieldEditor
          key={field.name}
          field={field}
          value={formValues[field.name]}
          error={fieldErrors[field.name]}
          onChangeField={onChangeField}
          onToggleOption={onToggleOption}
        />
      ))}

      <View style={styles.formField}>
        <Text style={styles.formLabel}>Change Reason *</Text>
        <TextInput
          testID="content-manager-change-reason"
          value={reason}
          onChangeText={onChangeReason}
          placeholder="What changed and why?"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          numberOfLines={3}
          style={[styles.textInput, styles.textAreaInput, reasonError && styles.textInputError]}
        />
        {reasonError ? <Text style={styles.errorText}>{reasonError}</Text> : null}
      </View>

      {saveError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.error} />
          <Text style={styles.errorBannerText}>{saveError}</Text>
        </View>
      ) : null}

      <View style={styles.saveBar}>
        <Text style={styles.saveBarHint}>
          {isDirty
            ? 'Changes apply live and create an audit entry.'
            : 'Make a change to enable saving.'}
        </Text>

        <View style={styles.saveActions}>
          <Pressable
            testID="content-manager-cancel-edit"
            onPress={onCancel}
            style={({ pressed }) => [styles.secondaryAction, pressed && { opacity: 0.88 }]}
          >
            <Text style={styles.secondaryActionText}>Cancel</Text>
          </Pressable>

          <Pressable
            testID="content-manager-save-metadata"
            disabled={!isDirty || !isValid || isSaving}
            onPress={onSave}
            style={({ pressed }) => [
              styles.primaryAction,
              (!isDirty || !isValid || isSaving) && styles.primaryActionDisabled,
              pressed && !isSaving && { opacity: 0.88 },
            ]}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={theme.colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="save-outline" size={16} color={theme.colors.textOnPrimary} />
                <Text style={styles.primaryActionText}>Save Changes</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </>
  );
}

function HistoryRows({
  item,
  history,
}: {
  item: ContentManagerItemDetail;
  history: ContentManagerAuditEntry[];
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!history.length) {
    return <Text style={styles.emptyMeta}>No metadata edits yet.</Text>;
  }

  return (
    <>
      {history.map((entry) => (
        <View key={entry.id} style={styles.historyCard}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyActor}>{getAuditActorLabel(entry)}</Text>
            <Text style={styles.historyTime}>{formatAuditTimestamp(entry)}</Text>
          </View>

          <Text style={styles.historyReason}>{entry.reason}</Text>
          <Text style={styles.historyFields}>
            Changed:{' '}
            {entry.changedFields
              .map((fieldName) => getContentManagerFieldLabel(item.collection, fieldName))
              .join(', ')}
          </Text>

          <View style={styles.historyChanges}>
            {entry.changedFields.map((fieldName) => (
              <View key={fieldName} style={styles.historyChangeRow}>
                <Text style={styles.historyChangeLabel}>
                  {getContentManagerFieldLabel(item.collection, fieldName)}
                </Text>
                <Text style={styles.historyChangeValue}>
                  {formatEditableValue(entry.before[fieldName])}
                  {' -> '}
                  {formatEditableValue(entry.after[fieldName])}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

export default function ContentManagerDetailScreen() {
  const router = useRouter();
  const { collection: rawCollection, id: rawId, reportId: rawReportId } = useLocalSearchParams<{
    collection?: string;
    id?: string;
    reportId?: string;
  }>();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const collection = isContentManagerCollection(rawCollection) ? rawCollection : null;
  const id = typeof rawId === 'string' ? rawId : null;
  const selectedReportId = typeof rawReportId === 'string' ? rawReportId : null;
  const {
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
    isDirty,
    isValid,
    refresh,
    startEditing,
    cancelEditing,
    setFieldValue,
    toggleFieldOption,
    setReason,
    saveMetadata,
    updateReportStatus,
    runRepairAction,
  } = useContentManagerDetail(collection, id, selectedReportId);
  const [copyHint, setCopyHint] = useState('');
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!copyHint) return;
    const timer = setTimeout(() => setCopyHint(''), 1800);
    return () => clearTimeout(timer);
  }, [copyHint]);

  const handleOpenLiveRoute = () => {
    if (!item) return;
    router.push(item.previewRoute);
  };

  const handleCopyId = async () => {
    if (!item) return;
    const copied = await copyTextToClipboard(item.id);
    setCopyHint(copied ? 'Copied ID' : 'Clipboard unavailable');
  };

  const handleOpenFactoryJob = () => {
    if (!repairAvailability?.job) return;
    router.push({
      pathname: '/admin/job/[id]',
      params: {
        id: repairAvailability.job.id,
      },
    });
  };

  const handleResolveReport = async (reportId: string, note?: string) => {
    await updateReportStatus(reportId, 'resolved', note);
  };

  const handleReopenReport = async (reportId: string) => {
    await updateReportStatus(reportId, 'open');
  };

  if (isLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.centerTitle}>Loading content detail</Text>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.centerState}>
        <Ionicons name="alert-circle-outline" size={44} color={theme.colors.error} />
        <Text style={styles.centerTitle}>Content unavailable</Text>
        <Text style={styles.centerBody}>{error || 'This content item could not be found.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <SectionCard title="Overview">
        <View style={styles.overviewRow}>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={styles.heroImage} />
          ) : (
            <View style={styles.heroFallback}>
              <Ionicons name="documents-outline" size={28} color={theme.colors.primary} />
            </View>
          )}

          <View style={styles.overviewText}>
            <Text style={styles.typePill}>{item.typeLabel}</Text>
            <Text style={styles.heroTitle}>{item.title}</Text>
            <Text style={styles.heroMeta}>
              {item.access === 'premium' ? 'Premium' : 'Free'} •{' '}
              {formatDuration(item.durationMinutes)}
            </Text>
            <Text style={styles.heroIdentifier}>{item.code || item.id}</Text>
            {item.description ? (
              <Text style={styles.heroDescription}>{item.description}</Text>
            ) : null}
          </View>
        </View>
      </SectionCard>

      <SectionCard
        title="Metadata"
        action={
          !isEditing ? (
            <Pressable
              testID="content-manager-edit-metadata"
              onPress={startEditing}
              style={({ pressed }) => [styles.inlineAction, pressed && { opacity: 0.88 }]}
            >
              <Ionicons name="create-outline" size={16} color={theme.colors.primary} />
              <Text style={styles.inlineActionText}>Edit Metadata</Text>
            </Pressable>
          ) : undefined
        }
      >
        {isEditing ? (
          <EditMetadataCard
            item={item}
            formValues={formValues}
            reason={reason}
            fieldErrors={fieldErrors}
            reasonError={reasonError}
            isDirty={isDirty}
            isValid={isValid}
            isSaving={isSaving}
            saveError={saveError}
            onChangeField={setFieldValue}
            onToggleOption={toggleFieldOption}
            onChangeReason={setReason}
            onCancel={cancelEditing}
            onSave={saveMetadata}
          />
        ) : (
          <MetadataRows item={item} />
        )}
      </SectionCard>

      <SectionCard title="Relations">
        {item.relations.length > 0 ? (
          item.relations.map((relation) => (
            <Pressable
              key={`${relation.collection}:${relation.id}`}
              testID={`content-manager-relation-${relation.collection}-${relation.id}`}
              style={({ pressed }) => [styles.relationRow, pressed && { opacity: 0.9 }]}
              onPress={() =>
                router.push({
                  pathname: '/admin/content/[collection]/[id]',
                  params: {
                    collection: relation.collection,
                    id: relation.id,
                  },
                })
              }
            >
              <View style={styles.relationText}>
                <Text style={styles.relationLabel}>{relation.label}</Text>
                <Text style={styles.relationTitle}>{relation.title}</Text>
                <Text style={styles.relationMeta}>{relation.code || relation.id}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </Pressable>
          ))
        ) : (
          <Text style={styles.emptyMeta}>No related content for this item.</Text>
        )}
      </SectionCard>

      {repairAvailability ? (
        <SectionCard title="Repair Actions">
          {repairAvailability.message ? (
            <Text style={styles.emptyMeta}>{repairAvailability.message}</Text>
          ) : null}

          {repairError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.error} />
              <Text style={styles.errorBannerText}>{repairError}</Text>
            </View>
          ) : null}

          {repairMessage ? (
            <View style={styles.messageBanner}>
              <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.success} />
              <Text style={styles.messageBannerText}>{repairMessage}</Text>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            {repairAvailability.canOpenFactoryJob ? (
              <Pressable
                testID="content-manager-open-factory-job"
                onPress={handleOpenFactoryJob}
                style={({ pressed }) => [styles.secondaryAction, pressed && { opacity: 0.88 }]}
              >
                <Ionicons name="build-outline" size={16} color={theme.colors.text} />
                <Text style={styles.secondaryActionText}>Open Factory Job</Text>
              </Pressable>
            ) : null}

            {repairAvailability.canRegenerateAudioOnly ? (
              <Pressable
                testID="content-manager-regenerate-audio-only"
                onPress={() => runRepairAction('audio_only')}
                disabled={Boolean(isRepairing)}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  Boolean(isRepairing) && styles.secondaryActionDisabled,
                  pressed && !isRepairing && { opacity: 0.88 },
                ]}
              >
                {isRepairing === 'audio_only' ? (
                  <ActivityIndicator size="small" color={theme.colors.text} />
                ) : (
                  <>
                    <Ionicons name="refresh-outline" size={16} color={theme.colors.text} />
                    <Text style={styles.secondaryActionText}>Regenerate Audio Only</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {repairAvailability.canRegenerateScriptAndAudio ? (
              <Pressable
                testID="content-manager-regenerate-script-and-audio"
                onPress={() => runRepairAction('script_and_audio')}
                disabled={Boolean(isRepairing)}
                style={({ pressed }) => [
                  styles.primaryAction,
                  Boolean(isRepairing) && styles.primaryActionDisabled,
                  pressed && !isRepairing && { opacity: 0.88 },
                ]}
              >
                {isRepairing === 'script_and_audio' ? (
                  <ActivityIndicator size="small" color={theme.colors.textOnPrimary} />
                ) : (
                  <>
                    <Ionicons name="sparkles-outline" size={16} color={theme.colors.textOnPrimary} />
                    <Text style={styles.primaryActionText}>Regenerate Script + Audio</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {repairAvailability.canGenerateThumbnail ? (
              <Pressable
                testID="content-manager-generate-thumbnail"
                onPress={() => runRepairAction('thumbnail')}
                disabled={Boolean(isRepairing)}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  Boolean(isRepairing) && styles.secondaryActionDisabled,
                  pressed && !isRepairing && { opacity: 0.88 },
                ]}
              >
                {isRepairing === 'thumbnail' ? (
                  <ActivityIndicator size="small" color={theme.colors.text} />
                ) : (
                  <>
                    <Ionicons name="image-outline" size={16} color={theme.colors.text} />
                    <Text style={styles.secondaryActionText}>Generate Thumbnail</Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>

          {selectedReport ? (
            <Text style={styles.sectionHint}>
              Repair actions do not auto-resolve the selected report.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Reports">
        {selectedReport ? (
          <View style={styles.selectedReportHint}>
            <Ionicons name="flag-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.selectedReportHintText}>
              Opened from report {selectedReport.id}. The matching report is highlighted below.
            </Text>
          </View>
        ) : null}

        {reportError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.colors.error} />
            <Text style={styles.errorBannerText}>{reportError}</Text>
          </View>
        ) : null}

        {reportMessage ? (
          <View style={styles.messageBanner}>
            <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.success} />
            <Text style={styles.messageBannerText}>{reportMessage}</Text>
          </View>
        ) : null}

        {reports.length > 0 ? (
          reports.map((report) => (
            <ContentManagerReportCard
              key={report.id}
              report={report}
              selected={report.id === selectedReport?.id}
              noteDraft={reportNotes[report.id]}
              isUpdating={updatingReportId === report.id}
              onChangeNote={(reportId, note) =>
                setReportNotes((current) => ({
                  ...current,
                  [reportId]: note,
                }))
              }
              onResolve={handleResolveReport}
              onReopen={handleReopenReport}
            />
          ))
        ) : (
          <Text style={styles.emptyMeta}>No reports for this content item.</Text>
        )}
      </SectionCard>

      <SectionCard title="Actions">
        <View style={styles.actionsRow}>
          <Pressable
            testID="content-manager-open-live-route"
            onPress={handleOpenLiveRoute}
            style={({ pressed }) => [styles.primaryAction, pressed && { opacity: 0.88 }]}
          >
            <Ionicons name="open-outline" size={16} color={theme.colors.textOnPrimary} />
            <Text style={styles.primaryActionText}>Open Live Route</Text>
          </Pressable>

          <Pressable
            testID="content-manager-copy-id"
            onPress={handleCopyId}
            style={({ pressed }) => [styles.secondaryAction, pressed && { opacity: 0.88 }]}
          >
            <Ionicons name="copy-outline" size={16} color={theme.colors.text} />
            <Text style={styles.secondaryActionText}>Copy ID</Text>
          </Pressable>

          <Pressable
            testID="content-manager-refresh-detail"
            onPress={refresh}
            style={({ pressed }) => [styles.secondaryAction, pressed && { opacity: 0.88 }]}
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color={theme.colors.text} />
            ) : (
              <>
                <Ionicons name="refresh-outline" size={16} color={theme.colors.text} />
                <Text style={styles.secondaryActionText}>Refresh</Text>
              </>
            )}
          </Pressable>
        </View>

        <Text style={styles.copyHint}>
          {saveMessage ||
            repairMessage ||
            reportMessage ||
            copyHint ||
            'Metadata edits create audit history. Report status changes are tracked on each report.'}
        </Text>
      </SectionCard>

      <SectionCard title="History">
        <HistoryRows item={item} history={history} />
      </SectionCard>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      width: '100%',
      maxWidth: Platform.OS === 'web' ? 1040 : undefined,
      alignSelf: 'center',
      paddingHorizontal: 16,
      paddingVertical: 18,
      gap: 16,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingHorizontal: 24,
      backgroundColor: theme.colors.background,
    },
    centerTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 18,
      color: theme.colors.text,
    },
    centerBody: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      maxWidth: 420,
    },
    sectionCard: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.borderRadius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 18,
      gap: 16,
      ...theme.shadows.sm,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 18,
      color: theme.colors.text,
    },
    sectionBody: {
      gap: 14,
    },
    sectionHint: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    inlineAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: theme.borderRadius.full,
      backgroundColor: `${theme.colors.primary}14`,
    },
    inlineActionText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 13,
      color: theme.colors.primary,
    },
    overviewRow: {
      flexDirection: Platform.OS === 'web' ? 'row' : 'column',
      gap: 18,
    },
    heroImage: {
      width: 160,
      height: 160,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.gray[200],
    },
    heroFallback: {
      width: 160,
      height: 160,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: `${theme.colors.primary}14`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    overviewText: {
      flex: 1,
      gap: 8,
    },
    typePill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: theme.borderRadius.full,
      backgroundColor: `${theme.colors.primary}18`,
      color: theme.colors.primary,
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    heroTitle: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 30,
      color: theme.colors.text,
    },
    heroMeta: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    heroIdentifier: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.text,
    },
    heroDescription: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 15,
      lineHeight: 23,
      color: theme.colors.textSecondary,
      maxWidth: 720,
    },
    dataRow: {
      gap: 4,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    dataLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: theme.colors.textMuted,
    },
    dataValue: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 15,
      color: theme.colors.text,
      lineHeight: 22,
    },
    dataValueMonospace: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
    },
    emptyMeta: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textSecondary,
    },
    formField: {
      gap: 8,
    },
    formLabel: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 13,
      color: theme.colors.text,
    },
    textInput: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.text,
    },
    textAreaInput: {
      minHeight: 96,
      textAlignVertical: 'top',
    },
    textInputError: {
      borderColor: theme.colors.error,
    },
    helperText: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    errorText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.error,
    },
    optionGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    optionChip: {
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: theme.borderRadius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    optionChipSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: `${theme.colors.primary}16`,
    },
    optionChipText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    optionChipTextSelected: {
      color: theme.colors.primary,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: theme.borderRadius.md,
      backgroundColor: `${theme.colors.error}14`,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    errorBannerText: {
      flex: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.error,
    },
    messageBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: theme.borderRadius.md,
      backgroundColor: `${theme.colors.success}14`,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    messageBannerText: {
      flex: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.success,
    },
    saveBar: {
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingTop: 16,
    },
    saveBarHint: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    saveActions: {
      flexDirection: Platform.OS === 'web' ? 'row' : 'column',
      justifyContent: 'flex-end',
      gap: 10,
    },
    relationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      padding: 14,
    },
    relationText: {
      flex: 1,
      gap: 4,
    },
    relationLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: theme.colors.textMuted,
    },
    relationTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 15,
      color: theme.colors.text,
    },
    relationMeta: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.textSecondary,
    },
    actionsRow: {
      flexDirection: Platform.OS === 'web' ? 'row' : 'column',
      flexWrap: 'wrap',
      gap: 12,
    },
    primaryAction: {
      minHeight: 42,
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primaryActionDisabled: {
      opacity: 0.5,
    },
    primaryActionText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.textOnPrimary,
    },
    secondaryAction: {
      minHeight: 42,
      borderRadius: theme.borderRadius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 16,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    secondaryActionDisabled: {
      opacity: 0.5,
    },
    secondaryActionText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.text,
    },
    selectedReportHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: theme.borderRadius.md,
      backgroundColor: `${theme.colors.primary}12`,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    selectedReportHintText: {
      flex: 1,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.primary,
    },
    copyHint: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.textSecondary,
    },
    historyCard: {
      gap: 8,
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      padding: 14,
    },
    historyHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },
    historyActor: {
      flex: 1,
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.text,
    },
    historyTime: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    historyReason: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textSecondary,
    },
    historyFields: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: theme.colors.text,
    },
    historyChanges: {
      gap: 8,
    },
    historyChangeRow: {
      gap: 4,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    historyChangeLabel: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: theme.colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    historyChangeValue: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.textSecondary,
    },
  });
